#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Big-endian frames allow 256 MiB assets plus protocol overhead. Request:
 * opcode/u8, handle/u32, mode/u32, limit/f64, two length-prefixed paths, bytes.
 * Response: status/u8 and operation data, or errno/u32 and its message. */
#define MAX_FRAME (257u * 1024u * 1024u)
#define DIR_FLAGS (O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
enum {
  DIRECTORY = 1,
  CLOSE,
  SYNC,
  STAT,
  LIST,
  MKDIR,
  LSTAT,
  UNLINK,
  REMOVE,
  RENAME,
  READ,
  WRITE
};
typedef struct {
  unsigned char *data;
  size_t size, capacity, offset;
} Buffer;
_Static_assert(sizeof(double) == 8, "Protocol requires 64-bit doubles");
static int *handles;
static uint32_t handle_count;
static int reserve(Buffer *b, size_t n) {
  if (n > MAX_FRAME - b->size) {
    errno = EFBIG;
    return -1;
  }
  size_t required = b->size + n;
  if (required > b->capacity) {
    size_t capacity = required > b->capacity * 2 ? required : b->capacity * 2;
    if (capacity > MAX_FRAME)
      capacity = MAX_FRAME;
    void *data = realloc(b->data, capacity);
    if (!data)
      return -1;
    b->data = data;
    b->capacity = capacity;
  }
  return 0;
}
static int append(Buffer *b, const void *p, size_t n) {
  if (reserve(b, n))
    return -1;
  if (n)
    memcpy(b->data + b->size, p, n);
  b->size += n;
  return 0;
}
static int put32(Buffer *b, uint32_t n) {
  unsigned char p[4] = {n >> 24, n >> 16, n >> 8, n};
  return append(b, p, 4);
}
static uint32_t get32(const unsigned char *p) {
  return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 |
         p[3];
}
static int put_double(Buffer *b, double value) {
  uint64_t bits;
  unsigned char p[8];
  memcpy(&bits, &value, 8);
  for (unsigned i = 0; i < 8; i++)
    p[7 - i] = bits >> (i * 8);
  return append(b, p, 8);
}
static double get_double(const unsigned char *p) {
  uint64_t bits = 0;
  double value;
  for (unsigned i = 0; i < 8; i++)
    bits = (bits << 8) | p[i];
  memcpy(&value, &bits, 8);
  return value;
}
static int transfer(int fd, void *buffer, size_t size, int writing) {
  unsigned char *p = buffer;
  while (size) {
    ssize_t n = writing ? write(fd, p, size) : read(fd, p, size);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0) {
      if (!n)
        errno = EIO;
      return -1;
    }
    p += n;
    size -= (size_t)n;
  }
  return 0;
}
static char *string(Buffer *b) {
  if (b->size - b->offset < 4)
    return NULL;
  uint32_t n = get32(b->data + b->offset);
  b->offset += 4;
  if (n > b->size - b->offset || memchr(b->data + b->offset, 0, n))
    return NULL;
  char *s = malloc((size_t)n + 1);
  if (!s)
    return NULL;
  memcpy(s, b->data + b->offset, n);
  s[n] = 0;
  b->offset += n;
  return s;
}
static int handle(uint32_t id) {
  if (!id || id > handle_count || handles[id - 1] < 0) {
    errno = EBADF;
    return -1;
  }
  return handles[id - 1];
}
static int address(char *path, char **name) {
  if (strncmp(path, "/fd/", 4)) {
    errno = EINVAL;
    return -1;
  }
  char *p = path + 4;
  if (*p < '1' || *p > '9') {
    errno = EINVAL;
    return -1;
  }
  uint64_t id = 0;
  while (*p >= '0' && *p <= '9') {
    id = id * 10 + (unsigned)(*p++ - '0');
    if (id > UINT32_MAX) {
      errno = EINVAL;
      return -1;
    }
  }
  if (*p++ != '/' || !*p || strchr(p, '/') || !strcmp(p, ".") ||
      !strcmp(p, "..")) {
    errno = EINVAL;
    return -1;
  }
  *name = p;
  return handle((uint32_t)id);
}
static int stat_result(Buffer *out, const struct stat *s) {
#ifdef __APPLE__
  double ms = (double)s->st_mtimespec.tv_sec * 1000 +
              (double)s->st_mtimespec.tv_nsec / 1000000;
#else
  double ms =
      (double)s->st_mtim.tv_sec * 1000 + (double)s->st_mtim.tv_nsec / 1000000;
#endif
  return put_double(out, ms) || put_double(out, (double)s->st_dev) ||
                 put_double(out, (double)s->st_ino) ||
                 put_double(out, (double)s->st_uid) ||
                 put_double(out, (double)s->st_mode)
             ? -1
             : 0;
}
static int remove_entry(int parent, const char *name, unsigned depth) {
  if (depth > 256) {
    errno = ELOOP;
    return -1;
  }
  int fd = openat(parent, name, DIR_FLAGS);
  if (fd < 0) {
    if (errno == ENOENT)
      return 0;
    if (errno == ENOTDIR || errno == ELOOP)
      return unlinkat(parent, name, 0);
    return -1;
  }
  DIR *dir = fdopendir(fd);
  if (!dir) {
    int error = errno;
    close(fd);
    errno = error;
    return -1;
  }
  int result = 0;
  struct dirent *entry;
  errno = 0;
  while ((entry = readdir(dir))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, ".."))
      continue;
    if (remove_entry(fd, entry->d_name, depth + 1)) {
      result = -1;
      break;
    }
    errno = 0;
  }
  if (!result && errno)
    result = -1;
  int error = errno;
  closedir(dir);
  errno = error;
  return result ? -1 : unlinkat(parent, name, AT_REMOVEDIR);
}
static int execute(Buffer *in, Buffer *out) {
  if (in->size < 25) {
    errno = EINVAL;
    return -1;
  }
  unsigned op = in->data[0];
  uint32_t id = get32(in->data + 1), mode = get32(in->data + 5);
  double limit = get_double(in->data + 9);
  in->offset = 17;
  char *path = string(in), *target = path ? string(in) : NULL;
  if (!path || !target || op < DIRECTORY || op > WRITE ||
      (op != WRITE && in->offset != in->size) || mode > 0777) {
    free(path);
    free(target);
    errno = EINVAL;
    return -1;
  }
  int result = -1, fd = -1, parent = -1;
  char *name = NULL;
  struct stat info;
  if (op == DIRECTORY) {
    fd = !strncmp(path, "/fd/", 4) ? ((parent = address(path, &name)) < 0
                                          ? -1
                                          : openat(parent, name, DIR_FLAGS))
                                   : open(path, DIR_FLAGS);
    if (fd < 0)
      goto done;
    if (handle_count == UINT32_MAX) {
      errno = EMFILE;
      goto done;
    }
    int *next = realloc(handles, ((size_t)handle_count + 1) * sizeof(int));
    if (!next)
      goto done;
    handles = next;
    handles[handle_count++] = fd;
    fd = -1;
    result = put32(out, handle_count);
    goto done;
  }
  if (op >= CLOSE && op <= LIST) {
    parent = handle(id);
    if (parent < 0)
      goto done;
    if (op == CLOSE) {
      handles[id - 1] = -1;
      result = close(parent);
      goto done;
    }
    if (op == SYNC) {
      result = fsync(parent);
      goto done;
    }
    if (op == STAT) {
      result = fstat(parent, &info) ? -1 : stat_result(out, &info);
      goto done;
    }
    /* dup() would share the directory cursor across repeated list calls. */
    fd = openat(parent, ".", DIR_FLAGS);
    if (fd < 0)
      goto done;
    DIR *dir = fdopendir(fd);
    if (!dir)
      goto done;
    fd = -1;
    uint32_t count = 0;
    result = put32(out, 0);
    struct dirent *entry;
    errno = 0;
    while (!result && (entry = readdir(dir))) {
      if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, ".."))
        continue;
      if (fstatat(parent, entry->d_name, &info, AT_SYMLINK_NOFOLLOW)) {
        result = -1;
        break;
      }
      size_t n = strlen(entry->d_name);
      unsigned char directory = S_ISDIR(info.st_mode);
      if (put32(out, (uint32_t)n) || append(out, entry->d_name, n) ||
          append(out, &directory, 1)) {
        result = -1;
        break;
      }
      count++;
      errno = 0;
    }
    if (!result && errno)
      result = -1;
    int error = errno;
    closedir(dir);
    errno = error;
    if (!result) {
      unsigned char *p = out->data + 1;
      p[0] = count >> 24;
      p[1] = count >> 16;
      p[2] = count >> 8;
      p[3] = count;
    }
    goto done;
  }
  parent = address(path, &name);
  if (parent < 0)
    goto done;
  switch (op) {
  case MKDIR:
    result = mkdirat(parent, name, mode);
    break;
  case LSTAT:
    result = fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW)
                 ? -1
                 : stat_result(out, &info);
    break;
  case UNLINK:
    result = unlinkat(parent, name, 0);
    break;
  case REMOVE:
    result = remove_entry(parent, name, 0);
    break;
  case RENAME: {
    char *target_name;
    int target_parent = address(target, &target_name);
    if (target_parent >= 0)
      result = renameat(parent, name, target_parent, target_name);
    break;
  }
  case READ: {
    fd = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0)
      break;
    if (fstat(fd, &info))
      break;
    if (!S_ISREG(info.st_mode) || info.st_size < 0 || !(limit >= 0) ||
        (double)info.st_size > limit ||
        (uint64_t)info.st_size > MAX_FRAME - 1) {
      errno = EINVAL;
      break;
    }
    if (reserve(out, (size_t)info.st_size) ||
        transfer(fd, out->data + out->size, (size_t)info.st_size, 0))
      break;
    out->size += (size_t)info.st_size;
    unsigned char extra;
    ssize_t n;
    do {
      n = read(fd, &extra, 1);
    } while (n < 0 && errno == EINTR);
    if (n) {
      if (n > 0)
        errno = EINVAL;
      break;
    }
    result = 0;
    break;
  }
  case WRITE:
    fd = openat(parent, name,
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode);
    if (fd < 0)
      break;
    if (transfer(fd, in->data + in->offset, in->size - in->offset, 1))
      break;
    result = fsync(fd);
    break;
  default:
    errno = EINVAL;
  }
done: {
  int error = errno;
  if (fd >= 0 && close(fd) && !result) {
    result = -1;
    error = errno;
  }
  free(path);
  free(target);
  errno = error;
  return result;
}
}
int main(void) {
  int exit_code = 0;
  for (;;) {
    unsigned char header[4];
    ssize_t n;
    do {
      n = read(STDIN_FILENO, header, 1);
    } while (n < 0 && errno == EINTR);
    if (!n)
      break;
    if (n < 0 || transfer(STDIN_FILENO, header + 1, 3, 0)) {
      exit_code = 1;
      break;
    }
    uint32_t size = get32(header);
    if (size < 25 || size > MAX_FRAME) {
      exit_code = 1;
      break;
    }
    Buffer in = {0}, out = {0};
    if (reserve(&in, size)) {
      exit_code = 1;
      break;
    }
    in.size = size;
    if (transfer(STDIN_FILENO, in.data, size, 0)) {
      free(in.data);
      exit_code = 1;
      break;
    }
    unsigned char status = 0;
    if (append(&out, &status, 1)) {
      free(in.data);
      exit_code = 1;
      break;
    }
    if (execute(&in, &out)) {
      int error = errno ? errno : EINVAL;
      out.size = 0;
      status = 1;
      if (append(&out, &status, 1) || put32(&out, (uint32_t)error) ||
          append(&out, strerror(error), strlen(strerror(error)))) {
        free(in.data);
        free(out.data);
        exit_code = 1;
        break;
      }
    }
    Buffer prefix = {0};
    if (put32(&prefix, (uint32_t)out.size) ||
        transfer(STDOUT_FILENO, prefix.data, 4, 1) ||
        transfer(STDOUT_FILENO, out.data, out.size, 1))
      exit_code = 1;
    free(prefix.data);
    free(in.data);
    free(out.data);
    if (exit_code)
      break;
  }
  for (uint32_t i = 0; i < handle_count; i++)
    if (handles[i] >= 0)
      close(handles[i]);
  free(handles);
  return exit_code;
}
