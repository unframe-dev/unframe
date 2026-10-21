package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

type request struct {
	ID       int    `json:"id"`
	Op       string `json:"op"`
	Path     string `json:"path"`
	Target   string `json:"target"`
	Handle   int    `json:"handle"`
	Bytes    []byte `json:"bytes"`
	Limit    int64  `json:"limit"`
	Expected *int64 `json:"expected"`
	Mode     uint32 `json:"mode"`
}
type response struct {
	ID        int    `json:"id"`
	Value     any    `json:"value,omitempty"`
	Code      string `json:"code,omitempty"`
	Operation string `json:"operation,omitempty"`
}
type metadata struct {
	Dev     uint64 `json:"dev"`
	Ino     uint64 `json:"ino"`
	Size    int64  `json:"size"`
	MtimeMs int64  `json:"mtimeMs"`
	Kind    string `json:"kind"`
	Uid     uint32 `json:"uid"`
	Mode    uint32 `json:"mode"`
}

func statValue(s fs.FileInfo) metadata {
	raw := s.Sys().(*syscall.Stat_t)
	kind := "other"
	if s.Mode()&os.ModeSymlink != 0 {
		kind = "symlink"
	} else if s.IsDir() {
		kind = "directory"
	} else if s.Mode().IsRegular() {
		kind = "file"
	}
	return metadata{uint64(raw.Dev), uint64(raw.Ino), s.Size(), s.ModTime().UnixMilli(), kind, raw.Uid, uint32(raw.Mode)}
}
func same(a, b fs.FileInfo) bool {
	x, y := statValue(a), statValue(b)
	return x.Dev == y.Dev && x.Ino == y.Ino && x.Kind == y.Kind
}

var invalid = syscall.EINVAL

type operationError struct {
	operation string
	cause     error
}

func (e *operationError) Error() string { return e.operation }
func (e *operationError) Unwrap() error { return e.cause }

func writeAll(writer io.Writer, bytes []byte) error {
	for len(bytes) > 0 {
		n, err := writer.Write(bytes)
		if err != nil {
			return err
		}
		if n <= 0 || n > len(bytes) {
			return io.ErrShortWrite
		}
		bytes = bytes[n:]
	}
	return nil
}

func readBounded(file *os.File, limit int64, expected *int64, afterStat func()) ([]byte, error) {
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() || stat.Size() < 0 || stat.Size() > limit || (expected != nil && stat.Size() != *expected) {
		return nil, invalid
	}
	if afterStat != nil {
		afterStat()
	}
	bytes := make([]byte, int(stat.Size()))
	if _, err := io.ReadFull(file, bytes); err != nil {
		return nil, err
	}
	probe := make([]byte, 1)
	n, err := file.Read(probe)
	if n != 0 || err != io.EOF {
		return nil, invalid
	}
	after, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !same(stat, after) || after.Size() != stat.Size() {
		return nil, invalid
	}
	return bytes, nil
}

func checkedPath(path string, directory bool) (fs.FileInfo, string, error) {
	if !filepath.IsAbs(path) {
		return nil, "", invalid
	}
	current := string(filepath.Separator)
	for _, name := range strings.Split(path, string(filepath.Separator)) {
		if name == "" {
			continue
		}
		current = filepath.Join(current, name)
		stat, err := os.Lstat(current)
		if err != nil {
			return nil, "", err
		}
		if stat.Mode()&os.ModeSymlink != 0 {
			return nil, "", invalid
		}
	}
	stat, err := os.Lstat(path)
	if err != nil {
		return nil, "", err
	}
	if (directory && !stat.IsDir()) || (!directory && !stat.Mode().IsRegular()) {
		return nil, "", invalid
	}
	resolved, err := filepath.EvalSymlinks(path)
	return stat, resolved, err
}
func stablePath(path string, before fs.FileInfo, resolved string, directory bool) bool {
	after, actual, err := checkedPath(path, directory)
	return err == nil && actual == resolved && same(before, after)
}
func checkedOperation(r request) (any, error) {
	directory := r.Op != "readChecked"
	before, resolved, err := checkedPath(r.Path, directory)
	if err != nil {
		return nil, err
	}
	flags := os.O_RDONLY | syscall.O_NOFOLLOW | syscall.O_NONBLOCK
	if directory {
		flags |= syscall.O_DIRECTORY
	}
	file, err := os.OpenFile(r.Path, flags, 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !same(before, opened) {
		return nil, invalid
	}
	var value any = resolved
	if r.Op == "readChecked" {
		value, err = readBounded(file, r.Limit, r.Expected, nil)
	} else if r.Op == "listChecked" {
		var entries []fs.DirEntry
		entries, err = file.ReadDir(-1)
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		value = names
	}
	if err != nil {
		return nil, err
	}
	if !stablePath(r.Path, before, resolved, directory) {
		return nil, invalid
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	return value, nil
}

type directory struct {
	file *os.File
	root *os.Root
}

func (d *directory) close() error { a := d.root.Close(); b := d.file.Close(); return errors.Join(a, b) }

type server struct {
	handles map[int]*directory
	next    int
}

func (s *server) close() {
	for _, d := range s.handles {
		_ = d.close()
	}
	clear(s.handles)
}
func (s *server) scoped(path string) (*os.Root, string, error) {
	if !strings.HasPrefix(path, "@fd:") {
		return nil, path, nil
	}
	parts := strings.SplitN(strings.TrimPrefix(path, "@fd:"), "/", 2)
	id, err := strconv.Atoi(parts[0])
	if err != nil || id < 1 || strconv.Itoa(id) != parts[0] {
		return nil, "", invalid
	}
	d := s.handles[id]
	if d == nil {
		return nil, "", syscall.EBADF
	}
	name := "."
	if len(parts) == 2 {
		name = parts[1]
	}
	return d.root, name, nil
}
func openFile(root *os.Root, path string, flags int, mode fs.FileMode) (*os.File, error) {
	if root != nil {
		return root.OpenFile(path, flags, mode)
	}
	return os.OpenFile(path, flags, mode)
}
func (s *server) execute(r request) (any, error) {
	if r.Mode == 0 {
		r.Mode = 0600
		if r.Op == "mkdir" {
			r.Mode = 0700
		}
	}
	if r.Mode & ^uint32(0777) != 0 {
		return nil, invalid
	}

	if r.Op == "readChecked" || r.Op == "directoryChecked" || r.Op == "listChecked" {
		return checkedOperation(r)
	}
	if r.Op == "closeAll" {
		s.close()
		return true, nil
	}
	if r.Op == "statHandle" || r.Op == "syncHandle" || r.Op == "closeHandle" {
		d := s.handles[r.Handle]
		if d == nil {
			return nil, syscall.EBADF
		}
		switch r.Op {
		case "closeHandle":
			delete(s.handles, r.Handle)
			return true, d.close()
		case "syncHandle":
			return true, d.file.Sync()
		default:
			stat, err := d.file.Stat()
			if err != nil {
				return nil, err
			}
			return statValue(stat), nil
		}
	}
	root, path, err := s.scoped(r.Path)
	if err != nil {
		return nil, err
	}
	switch r.Op {
	case "sameDirectory":
		d := s.handles[r.Handle]
		if d == nil {
			return nil, syscall.EBADF
		}
		opened, err := d.file.Stat()
		if err != nil {
			return nil, err
		}
		var actual fs.FileInfo
		if root != nil {
			actual, err = root.Lstat(path)
		} else {
			actual, err = os.Lstat(path)
		}
		if err != nil {
			return false, nil
		}
		return actual.IsDir() && same(opened, actual), nil
	case "openDirectory":
		var before fs.FileInfo
		var resolved string
		if root == nil {
			before, resolved, err = checkedPath(path, true)
			if err != nil {
				return nil, err
			}
		}
		file, err := openFile(root, path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return nil, err
		}
		var anchored *os.Root
		if root != nil {
			anchored, err = root.OpenRoot(path)
		} else {
			anchored, err = os.OpenRoot(path)
		}
		if err != nil {
			file.Close()
			return nil, err
		}
		opened, a := file.Stat()
		pinned, b := anchored.Stat(".")
		if a != nil || b != nil || !same(opened, pinned) {
			file.Close()
			anchored.Close()
			return nil, invalid
		}
		if root == nil && (!same(before, opened) || !stablePath(path, before, resolved, true)) {
			file.Close()
			anchored.Close()
			return nil, invalid
		}
		s.next++
		s.handles[s.next] = &directory{file, anchored}
		return map[string]any{"id": s.next, "stat": statValue(opened)}, nil
	case "read":
		file, err := openFile(root, path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		bytes, err := readBounded(file, r.Limit, r.Expected, nil)
		if err != nil {
			return nil, err
		}
		return bytes, file.Close()
	case "write":
		file, err := openFile(root, path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, fs.FileMode(r.Mode))
		if err != nil {
			return nil, &operationError{"open", err}
		}
		defer file.Close()
		opened, err := file.Stat()
		if err != nil {
			return nil, &operationError{"stat-opened", err}
		}
		if !opened.Mode().IsRegular() {
			return nil, &operationError{"stat-opened", invalid}
		}
		if err = writeAll(file, r.Bytes); err != nil {
			return nil, &operationError{"write", err}
		}
		if err = file.Sync(); err != nil {
			return nil, &operationError{"sync", err}
		}
		after, err := file.Stat()
		if err != nil {
			return nil, &operationError{"stat-synced", err}
		}
		if !same(opened, after) || after.Size() != int64(len(r.Bytes)) {
			return nil, &operationError{"stat-synced", invalid}
		}
		if err = file.Close(); err != nil {
			return nil, &operationError{"close", err}
		}
		var final fs.FileInfo
		if root != nil {
			final, err = root.Lstat(path)
		} else {
			final, err = os.Lstat(path)
		}
		if err != nil || !same(opened, final) || final.Size() != int64(len(r.Bytes)) {
			return nil, invalid
		}
		return true, nil
	case "lstat":
		var stat fs.FileInfo
		if root != nil {
			stat, err = root.Lstat(path)
		} else {
			stat, err = os.Lstat(path)
		}
		if err != nil {
			return nil, err
		}
		return statValue(stat), nil
	case "mkdir":
		if root != nil {
			err = root.Mkdir(path, fs.FileMode(r.Mode))
		} else {
			err = os.Mkdir(path, fs.FileMode(r.Mode))
		}
		return true, err
	case "remove":
		if root != nil {
			err = root.RemoveAll(path)
		} else {
			err = os.RemoveAll(path)
		}
		return true, err
	case "unlink":
		if root != nil {
			err = root.Remove(path)
		} else {
			err = os.Remove(path)
		}
		return true, err
	case "readlink":
		if root != nil {
			return root.Readlink(path)
		}
		return os.Readlink(path)
	case "symlink":
		if root != nil {
			err = root.Symlink(r.Target, path)
		} else {
			err = os.Symlink(r.Target, path)
		}
		return true, err
	case "rename":
		targetRoot, target, err := s.scoped(r.Target)
		if err != nil {
			return nil, err
		}
		if root != targetRoot {
			if root == nil || targetRoot == nil {
				return nil, syscall.EXDEV
			}
			if path == "." || path == ".." || target == "." || target == ".." || strings.Contains(path, "/") || strings.Contains(target, "/") {
				return nil, invalid
			}
			var sourceDirectory, targetDirectory *directory
			for _, candidate := range s.handles {
				if candidate.root == root {
					sourceDirectory = candidate
				}
				if candidate.root == targetRoot {
					targetDirectory = candidate
				}
			}
			if sourceDirectory == nil || targetDirectory == nil {
				return nil, syscall.EBADF
			}
			return true, unix.Renameat(int(sourceDirectory.file.Fd()), path, int(targetDirectory.file.Fd()), target)
		}
		if root != nil {
			err = root.Rename(path, target)
		} else {
			err = os.Rename(path, target)
		}
		return true, err
	case "list":
		file, err := openFile(root, path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		entries, err := file.ReadDir(-1)
		if err != nil {
			return nil, err
		}
		result := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			result = append(result, map[string]any{"name": e.Name(), "directory": e.IsDir()})
		}
		return result, nil
	}
	return nil, invalid
}
func errorCode(err error) string {
	for code, errno := range map[string]error{"EACCES": syscall.EACCES, "EBADF": syscall.EBADF, "EEXIST": syscall.EEXIST, "EIO": syscall.EIO, "EISDIR": syscall.EISDIR, "ELOOP": syscall.ELOOP, "ENOENT": syscall.ENOENT, "ENOSPC": syscall.ENOSPC, "ENOTDIR": syscall.ENOTDIR, "ENOTEMPTY": syscall.ENOTEMPTY, "EPERM": syscall.EPERM, "EROFS": syscall.EROFS, "EXDEV": syscall.EXDEV} {
		if errors.Is(err, errno) {
			return code
		}
	}
	return "EINVAL"
}
func main() {
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	decoder := json.NewDecoder(bufio.NewReader(os.Stdin))
	encoder := json.NewEncoder(os.Stdout)
	for {
		var r request
		if err := decoder.Decode(&r); err != nil {
			if err != io.EOF {
				fmt.Fprintln(os.Stderr, "Invalid filesystem request")
			}
			return
		}
		value, err := s.execute(r)
		out := response{ID: r.ID, Value: value}
		if err != nil {
			out.Value = nil
			out.Code = errorCode(err)
			var operation *operationError
			if errors.As(err, &operation) {
				out.Operation = operation.operation
			}
		}
		if encoder.Encode(out) != nil {
			return
		}
	}
}
