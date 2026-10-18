package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestBoundedReadRejectsGrowthAndShrink(t *testing.T) {
	for _, change := range []string{"grow", "shrink"} {
		t.Run(change, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "input")
			if err := os.WriteFile(path, []byte("base"), 0600); err != nil {
				t.Fatal(err)
			}
			f, err := os.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			_, err = readBounded(f, 4, nil, func() {
				if change == "grow" {
					file, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
					defer file.Close()
					_, _ = file.WriteString("more")
				} else {
					_ = os.Truncate(path, 1)
				}
			})
			if err == nil {
				t.Fatal("accepted changed file")
			}
		})
	}
}

func TestWriteAllRetriesPartialWrites(t *testing.T) {
	w := &partialWriter{}
	if err := writeAll(w, []byte("abcdef")); err != nil {
		t.Fatal(err)
	}
	if string(w.bytes) != "abcdef" {
		t.Fatalf("partial output: %q", w.bytes)
	}
}

type partialWriter struct{ bytes []byte }

func (w *partialWriter) Write(p []byte) (int, error) {
	n := min(2, len(p))
	w.bytes = append(w.bytes, p[:n]...)
	return n, nil
}

type failedWriter struct{}

func (failedWriter) Write([]byte) (int, error) { return 1, errors.New("disk failed") }
func TestWriteAllPropagatesFailure(t *testing.T) {
	if writeAll(failedWriter{}, []byte("abc")) == nil {
		t.Fatal("ignored write failure")
	}
}

func TestPinnedDirectorySurvivesParentReplacement(t *testing.T) {
	root := t.TempDir()
	original := filepath.Join(root, "parent")
	if err := os.Mkdir(original, 0700); err != nil {
		t.Fatal(err)
	}
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	value, err := s.execute(request{Op: "openDirectory", Path: original})
	if err != nil {
		t.Fatal(err)
	}
	handle := value.(map[string]any)["id"].(int)
	if err = os.Rename(original, original+"-moved"); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err = os.Symlink(outside, original); err != nil {
		t.Fatal(err)
	}
	if _, err = s.execute(request{Op: "write", Path: fmt.Sprintf("@fd:%d/file", handle), Bytes: []byte("pinned")}); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(original+"-moved", "file"))
	if err != nil || string(bytes) != "pinned" {
		t.Fatalf("lost pinned directory: %q %v", bytes, err)
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatal("wrote through replacement symlink")
	}
}

func TestCloseReleasesEveryOwnedDirectory(t *testing.T) {
	s := &server{handles: make(map[int]*directory)}
	if _, err := s.execute(request{Op: "openDirectory", Path: t.TempDir()}); err != nil {
		t.Fatal(err)
	}
	d := s.handles[1]
	s.close()
	if len(s.handles) != 0 {
		t.Fatal("retained handle")
	}
	if _, err := d.file.Stat(); !errors.Is(err, os.ErrClosed) {
		t.Fatal("directory descriptor still open")
	}
	if _, err := d.root.Stat("."); !errors.Is(err, os.ErrClosed) {
		t.Fatal("root descriptor still open")
	}
}

func TestRenameRejectsDifferentDirectoryRoots(t *testing.T) {
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	for i := 0; i < 2; i++ {
		if _, err := s.execute(request{Op: "openDirectory", Path: t.TempDir()}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.execute(request{Op: "write", Path: "@fd:1/source", Bytes: []byte("owned")}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.execute(request{Op: "rename", Path: "@fd:1/source", Target: "@fd:2/target"}); !errors.Is(err, syscall.EXDEV) {
		t.Fatalf("expected EXDEV, got %v", err)
	}
	if _, err := s.execute(request{Op: "rename", Path: "@fd:1/source", Target: "@fd:1/target"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.execute(request{Op: "lstat", Path: "@fd:1/target"}); err != nil {
		t.Fatal(err)
	}
}
