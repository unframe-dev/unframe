import base64
import errno
import json
import os
import stat
import sys

handles = {}
next_id = 0
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def address(path):
    parts = path.split('/')
    if len(parts) != 4 or parts[1] != 'fd' or parts[3] in ('', '.', '..'):
        raise ValueError('Invalid relative cache address')
    return handles[int(parts[2])], parts[3]


def remove(parent, name):
    try:
        fd = os.open(name, flags, dir_fd=parent)
    except FileNotFoundError:
        return
    except OSError as error:
        if error.errno not in (errno.ENOTDIR, errno.ELOOP):
            raise
        os.unlink(name, dir_fd=parent)
        return
    try:
        for child in os.listdir(fd):
            remove(fd, child)
    finally:
        os.close(fd)
    os.rmdir(name, dir_fd=parent)


def stat_info(value):
    return {"mtimeMs": value.st_mtime_ns / 1000000, "dev": value.st_dev, "ino": value.st_ino, "uid": value.st_uid, "mode": value.st_mode}


def execute(request):
    global next_id
    op = request['op']
    if op == 'directory':
        path = request['path']
        fd = os.open(path, flags) if not path.startswith('/fd/') else os.open(address(path)[1], flags, dir_fd=address(path)[0])
        next_id += 1
        handles[next_id] = fd
        return next_id
    if op in ('close', 'sync', 'stat'):
        fd = handles[request['id']]
        if op == 'close':
            os.close(fd)
            del handles[request['id']]
        elif op == 'sync':
            os.fsync(fd)
        else:
            return stat_info(os.fstat(fd))
        return None
    if op == 'list':
        fd = handles[request['id']]
        return [{'name': name, 'directory': stat.S_ISDIR(os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode)} for name in os.listdir(fd)]
    parent, name = address(request['path'])
    if op == 'mkdir':
        os.mkdir(name, request.get('mode', 0o700), dir_fd=parent)
    elif op == 'lstat':
        return stat_info(os.stat(name, dir_fd=parent, follow_symlinks=False))
    elif op == 'unlink':
        os.unlink(name, dir_fd=parent)
    elif op == 'remove':
        remove(parent, name)
    elif op == 'rename':
        target_parent, target_name = address(request['target'])
        os.rename(name, target_name, src_dir_fd=parent, dst_dir_fd=target_parent)
    elif op == 'read':
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > request['limit']:
                raise ValueError('Invalid cache file')
            chunks = []
            remaining = info.st_size
            while remaining:
                chunk = os.read(fd, min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError('Cache file shrank during read')
                chunks.append(chunk)
                remaining -= len(chunk)
            if os.read(fd, 1):
                raise ValueError('Cache file grew during read')
            return base64.b64encode(b''.join(chunks)).decode('ascii')
        finally:
            os.close(fd)
    elif op == 'write':
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, request.get('mode', 0o600), dir_fd=parent)
        try:
            data = memoryview(base64.b64decode(request['bytes'], validate=True))
            while data:
                count = os.write(fd, data)
                data = data[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
    else:
        raise ValueError('Invalid cache operation')
    return None


for line in sys.stdin:
    try:
        value = execute(json.loads(line))
        reply = {'value': value}
    except Exception as error:
        reply = {'error': str(error), 'code': errno.errorcode.get(getattr(error, 'errno', None), 'EINVAL')}
    print(json.dumps(reply), flush=True)
for fd in handles.values():
    os.close(fd)
