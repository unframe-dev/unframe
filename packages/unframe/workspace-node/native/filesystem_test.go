package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
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

func TestRenameUsesPinnedSourceAndDestinationDirectories(t *testing.T) {
	base := t.TempDir()
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	for _, name := range []string{"source", "destination"} {
		path := filepath.Join(base, name)
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
		if _, err := s.execute(request{Op: "openDirectory", Path: path}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.execute(request{Op: "write", Path: "@fd:1/asset", Bytes: []byte("owned")}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"source", "destination"} {
		path := filepath.Join(base, name)
		if err := os.Rename(path, path+"-moved"); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(t.TempDir(), path); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.execute(request{Op: "rename", Path: "@fd:1/asset", Target: "@fd:2/asset"}); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(base, "destination-moved", "asset"))
	if err != nil || string(bytes) != "owned" {
		t.Fatalf("lost pinned destination: %q %v", bytes, err)
	}
	if _, err := s.execute(request{Op: "rename", Path: "@fd:2/nested/asset", Target: "@fd:1/asset"}); !errors.Is(err, syscall.EINVAL) {
		t.Fatalf("accepted intermediate path: %v", err)
	}
}

func TestReadRejectsFifoWithoutWaitingForWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fifo")
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	finished := make(chan error, 1)
	go func() { _, err := s.execute(request{Op: "read", Path: path, Limit: 10}); finished <- err }()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("accepted FIFO")
		}
	case <-time.After(250 * time.Millisecond):
		file, _ := os.OpenFile(path, os.O_RDWR|syscall.O_NONBLOCK, 0)
		if file != nil {
			defer file.Close()
		}
		t.Fatal("read waited for a FIFO writer")
	}
}

func TestExchangeSwapsNonemptyDirectories(t *testing.T) {
	parent := t.TempDir()
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	if _, err := s.execute(request{Op: "openDirectory", Path: parent}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"staging", "output"} {
		if err := os.Mkdir(filepath.Join(parent, name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(parent, name, "content"), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.execute(request{Op: "exchange", Path: "@fd:1/staging", Target: "@fd:1/output"}); err != nil {
		t.Fatal(err)
	}
	for name, expected := range map[string]string{"staging": "output", "output": "staging"} {
		bytes, err := os.ReadFile(filepath.Join(parent, name, "content"))
		if err != nil || string(bytes) != expected {
			t.Fatalf("%s: got %q, %v; want %q", name, bytes, err, expected)
		}
	}
}

func TestExchangeKeepsPinnedParentAfterReplacement(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "parent")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal(err)
	}
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	if _, err := s.execute(request{Op: "openDirectory", Path: parent}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"staging", "output"} {
		if err := os.Mkdir(filepath.Join(parent, name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(parent, name, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Rename(parent, parent+"-moved"); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, parent); err != nil {
		t.Fatal(err)
	}
	if _, err := s.execute(request{Op: "exchange", Path: "@fd:1/staging", Target: "@fd:1/output"}); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"staging": "output", "output": "staging"} {
		if _, err := os.Stat(filepath.Join(parent+"-moved", name, content)); err != nil {
			t.Fatalf("exchange lost pinned parent: %v", err)
		}
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatal("exchange followed replaced parent")
	}
}

func TestAtomicRenameAcrossPinnedParentsKeepsBothParentsPinned(t *testing.T) {
	for _, operation := range []string{"exchange", "renameNoReplace"} {
		t.Run(operation, func(t *testing.T) {
			root := t.TempDir()
			parents := []string{filepath.Join(root, "source"), filepath.Join(root, "target")}
			s := &server{handles: make(map[int]*directory)}
			defer s.close()
			for _, parent := range parents {
				if err := os.Mkdir(parent, 0700); err != nil {
					t.Fatal(err)
				}
				if _, err := s.execute(request{Op: "openDirectory", Path: parent}); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.Mkdir(filepath.Join(parents[0], "staging"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(parents[0], "staging", "content"), []byte("next"), 0600); err != nil {
				t.Fatal(err)
			}
			if operation == "exchange" {
				if err := os.Mkdir(filepath.Join(parents[1], "output"), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(parents[1], "output", "content"), []byte("previous"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			outside := t.TempDir()
			for _, parent := range parents {
				if err := os.Rename(parent, parent+"-owned"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, parent); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.execute(request{Op: operation, Path: "@fd:1/staging", Target: "@fd:2/output"}); err != nil {
				t.Fatal(err)
			}
			bytes, err := os.ReadFile(filepath.Join(parents[1]+"-owned", "output", "content"))
			if err != nil || string(bytes) != "next" {
				t.Fatalf("got %q, %v", bytes, err)
			}
			if operation == "exchange" {
				bytes, err = os.ReadFile(filepath.Join(parents[0]+"-owned", "staging", "content"))
				if err != nil || string(bytes) != "previous" {
					t.Fatalf("rollback directory: got %q, %v", bytes, err)
				}
			}
			entries, err := os.ReadDir(outside)
			if err != nil || len(entries) != 0 {
				t.Fatal("atomic rename followed a replaced parent")
			}
		})
	}
}

func TestAtomicRenameAcrossPinnedParentsRejectsUnsafeEntries(t *testing.T) {
	for _, operation := range []string{"exchange", "renameNoReplace"} {
		t.Run(operation, func(t *testing.T) {
			parents := []string{t.TempDir(), t.TempDir()}
			s := &server{handles: make(map[int]*directory)}
			defer s.close()
			for _, parent := range parents {
				if _, err := s.execute(request{Op: "openDirectory", Path: parent}); err != nil {
					t.Fatal(err)
				}
				for _, name := range []string{"staging", "output"} {
					if err := os.Mkdir(filepath.Join(parent, name), 0700); err != nil {
						t.Fatal(err)
					}
				}
				if err := os.Symlink("staging", filepath.Join(parent, "link")); err != nil {
					t.Fatal(err)
				}
			}
			cases := []struct {
				path, target string
				want         error
			}{
				{"@fd:1/link", "@fd:2/output", invalid},
				{"@fd:1/staging/nested", "@fd:2/output", invalid},
				{"@fd:1/staging", "@fd:2/link/nested", invalid},
				{"@fd:1/staging", "@fd:2/../output", invalid},
				{"@fd:1/staging", "@fd:99/output", syscall.EBADF},
			}
			if operation == "exchange" {
				cases = append(cases, struct {
					path, target string
					want         error
				}{"@fd:1/staging", "@fd:2/link", invalid})
			} else {
				cases = append(cases, struct {
					path, target string
					want         error
				}{"@fd:1/staging", "@fd:2/output", syscall.EEXIST})
			}
			for _, tc := range cases {
				if _, err := s.execute(request{Op: operation, Path: tc.path, Target: tc.target}); !errors.Is(err, tc.want) {
					t.Fatalf("%s -> %s: got %v, want %v", tc.path, tc.target, err, tc.want)
				}
			}
			for _, parent := range parents {
				for _, name := range []string{"staging", "output"} {
					stat, err := os.Lstat(filepath.Join(parent, name))
					if err != nil || !stat.IsDir() {
						t.Fatalf("rejected rename changed %s: %v", name, err)
					}
				}
			}
		})
	}
}

func TestExchangeRejectsPathsOutsidePinnedSiblings(t *testing.T) {
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	parents := []string{t.TempDir(), t.TempDir()}
	for _, parent := range parents {
		if _, err := s.execute(request{Op: "openDirectory", Path: parent}); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"staging", "output"} {
			if err := os.Mkdir(filepath.Join(parent, name), 0700); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := os.Symlink("staging", filepath.Join(parents[0], "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parents[0], "file"), []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, path, target string
		want               error
	}{
		{"absolute", filepath.Join(parents[0], "staging"), filepath.Join(parents[0], "output"), invalid},
		{"mixed anchors", "@fd:1/staging", filepath.Join(parents[0], "output"), syscall.EXDEV},
		{"parent traversal", "@fd:1/../staging", "@fd:1/output", invalid},
		{"absolute in anchor", "@fd:1//staging", "@fd:1/output", invalid},
		{"root", "@fd:1", "@fd:1/output", invalid},
		{"dot", "@fd:1/.", "@fd:1/output", invalid},
		{"empty", "@fd:1/", "@fd:1/output", invalid},
		{"nested", "@fd:1/staging/nested", "@fd:1/output", invalid},
		{"symlink parent", "@fd:1/link/nested", "@fd:1/output", invalid},
		{"source symlink", "@fd:1/link", "@fd:1/output", invalid},
		{"target symlink", "@fd:1/staging", "@fd:1/link", invalid},
		{"file", "@fd:1/file", "@fd:1/output", invalid},
		{"missing", "@fd:1/missing", "@fd:1/output", syscall.ENOENT},
		{"closed handle", "@fd:99/staging", "@fd:99/output", syscall.EBADF},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.execute(request{Op: "exchange", Path: tc.path, Target: tc.target}); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
	for _, parent := range parents {
		for _, name := range []string{"staging", "output"} {
			stat, err := os.Lstat(filepath.Join(parent, name))
			if err != nil || !stat.IsDir() {
				t.Fatalf("rejected exchange changed %s: %v", name, err)
			}
		}
	}
}

func TestRenameNoReplacePublishesOnlyToAbsentDirectory(t *testing.T) {
	for _, exists := range []bool{false, true} {
		t.Run(fmt.Sprintf("target-exists=%v", exists), func(t *testing.T) {
			parent := t.TempDir()
			s := &server{handles: make(map[int]*directory)}
			defer s.close()
			if _, err := s.execute(request{Op: "openDirectory", Path: parent}); err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(parent, "staging")
			target := filepath.Join(parent, "output")
			if err := os.Mkdir(source, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "content"), []byte("new"), 0600); err != nil {
				t.Fatal(err)
			}
			if exists {
				if err := os.Mkdir(target, 0700); err != nil {
					t.Fatal(err)
				}
			}
			_, err := s.execute(request{Op: "renameNoReplace", Path: "@fd:1/staging", Target: "@fd:1/output"})
			if exists {
				if !errors.Is(err, syscall.EEXIST) {
					t.Fatalf("got %v, want EEXIST", err)
				}
				bytes, err := os.ReadFile(filepath.Join(source, "content"))
				if err != nil || string(bytes) != "new" {
					t.Fatalf("source changed: %q, %v", bytes, err)
				}
				entries, err := os.ReadDir(target)
				if err != nil || len(entries) != 0 {
					t.Fatalf("existing empty target changed: %v, %v", entries, err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				bytes, err := os.ReadFile(filepath.Join(target, "content"))
				if err != nil || string(bytes) != "new" {
					t.Fatalf("missing published content: %q, %v", bytes, err)
				}
				if _, err := os.Lstat(source); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("source still present: %v", err)
				}
			}
		})
	}
}

func TestRenameNoReplaceRejectsUnsafePaths(t *testing.T) {
	parent := t.TempDir()
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	for _, path := range []string{parent, t.TempDir()} {
		if _, err := s.execute(request{Op: "openDirectory", Path: path}); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(parent, "staging"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("staging", filepath.Join(parent, "link")); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, path, target string
		want               error
	}{
		{"source symlink", "@fd:1/link", "@fd:1/output", invalid},
		{"target symlink", "@fd:1/staging", "@fd:1/link", syscall.EEXIST},
		{"source traversal", "@fd:1/../staging", "@fd:1/output", invalid},
		{"target traversal", "@fd:1/staging", "@fd:1/../output", invalid},
		{"nested target", "@fd:1/staging", "@fd:1/link/output", invalid},
		{"source root", "@fd:1", "@fd:1/output", invalid},
		{"target root", "@fd:1/staging", "@fd:1", invalid},
		{"unanchored", filepath.Join(parent, "staging"), filepath.Join(parent, "output"), invalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.execute(request{Op: "renameNoReplace", Path: tc.path, Target: tc.target}); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
	if stat, err := os.Lstat(filepath.Join(parent, "staging")); err != nil || !stat.IsDir() {
		t.Fatalf("source was changed: %v", err)
	}
	if link, err := os.Readlink(filepath.Join(parent, "link")); err != nil || link != "staging" {
		t.Fatalf("symlink was changed: %q, %v", link, err)
	}
}

func TestHashCheckedReturnsContentDigestAndObservesChangedBytes(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "input")
	if err := os.WriteFile(path, []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	value, err := s.execute(request{Op: "hashChecked", Path: path, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if value != "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("incorrect content digest: %v", value)
	}
	if err := os.WriteFile(path, []byte("abd"), 0600); err != nil {
		t.Fatal(err)
	}
	changed, err := s.execute(request{Op: "hashChecked", Path: path, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if changed == value {
		t.Fatal("same-size content change did not change digest")
	}
}

func TestHashCheckedRejectsUnsafeAndUnboundedInputs(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "input")
	if err := os.WriteFile(path, []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(path, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(root, filepath.Join(root, "directory-link")); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(root, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	expected := int64(2)
	for _, tc := range []struct {
		name, path string
		limit      int64
		expected   *int64
	}{
		{"symlink", filepath.Join(root, "link"), 3, nil},
		{"ancestor symlink", filepath.Join(root, "directory-link", "input"), 3, nil},
		{"directory", root, 3, nil},
		{"fifo", filepath.Join(root, "fifo"), 3, nil},
		{"relative", "input", 3, nil},
		{"size limit", path, 2, nil},
		{"expected size", path, 3, &expected},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.execute(request{Op: "hashChecked", Path: tc.path, Limit: tc.limit, Expected: tc.expected}); err == nil {
				t.Fatal("accepted unsafe input")
			}
		})
	}
}

func TestIdentitiesCheckedCapturesSelectedContentsLinksAndPermissions(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "input"), []byte("abc"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("input", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(root, "ignored"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	value, err := s.execute(request{Op: "identitiesChecked", Path: root, Names: []string{"input", "nested", "link"}, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	entries := value.([]fileIdentity)
	if len(entries) != 3 || entries[0].Hash != "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" || !entries[0].Executable || entries[1].Kind != "directory" || entries[2].Link != "input" {
		t.Fatalf("unexpected identities: %#v", value)
	}
	if err := os.WriteFile(filepath.Join(root, "input"), []byte("abd"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(root, "input"), 0600); err != nil {
		t.Fatal(err)
	}
	changed, err := s.execute(request{Op: "identitiesChecked", Path: root, Names: []string{"input"}, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if changed.([]fileIdentity)[0].Hash == entries[0].Hash || changed.([]fileIdentity)[0].Executable {
		t.Fatal("content or executable change was missed")
	}
}
func TestIdentitiesCheckedRejectsUnsafeEntries(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "input"), []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(root, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &server{handles: make(map[int]*directory)}
	defer s.close()
	for _, name := range []string{"../input", ".", "nested/input", "fifo"} {
		t.Run(name, func(t *testing.T) {
			if _, err := s.execute(request{Op: "identitiesChecked", Path: root, Names: []string{name}, Limit: 100}); err == nil {
				t.Fatal("accepted unsafe entry")
			}
		})
	}
	if _, err := s.execute(request{Op: "identitiesChecked", Path: root, Names: []string{"input"}, Limit: 2}); err == nil {
		t.Fatal("accepted oversized file")
	}
}
