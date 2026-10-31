package hostops

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleasePackagesExactDarwinARM64RevisionAndDigest(t *testing.T) {
	dir := t.TempDir()
	goTool := filepath.Join(dir, "go")
	body := `#!/bin/sh
set -eu
[ "$GOOS" = darwin ] && [ "$GOARCH" = arm64 ] && [ "$CGO_ENABLED" = 0 ]
while [ "$1" != -o ]; do shift; done
shift
printf hello > "$1"
`
	if err := os.WriteFile(goTool, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "release with spaces")
	if err := PackageRelease(context.Background(), ReleaseOptions{Root: dir, Output: output, SHA: strings.Repeat("a", 40), Go: goTool}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(output, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["schemaVersion"] != float64(1) || got["repository"] != "unframe-dev/unframe" || got["sha"] != strings.Repeat("a", 40) || got["platform"] != "darwin" || got["arch"] != "arm64" || got["sha256"] != "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" {
		t.Fatalf("unexpected manifest: %s", data)
	}
}

func TestReleaseRejectsAmbiguousRevisionAndPreservesExistingDirectory(t *testing.T) {
	dir := t.TempDir()
	output := filepath.Join(dir, "release")
	if err := PackageRelease(context.Background(), ReleaseOptions{Root: dir, Output: output, SHA: "main"}); err == nil {
		t.Fatal("accepted a branch as the release revision")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("invalid revision created output: %v", err)
	}
	if err := os.Mkdir(output, 0700); err != nil {
		t.Fatal(err)
	}
	if err := PackageRelease(context.Background(), ReleaseOptions{Root: dir, Output: output, SHA: strings.Repeat("a", 40)}); err == nil {
		t.Fatal("overwrote an existing release")
	}
	if _, err := os.Stat(output); err != nil {
		t.Fatal("removed an existing release")
	}
}

func TestReleaseFailureRemovesPartialOutputWithoutExposingChildOutput(t *testing.T) {
	dir := t.TempDir()
	goTool := filepath.Join(dir, "go")
	if err := os.WriteFile(goTool, []byte("#!/bin/sh\necho fixture-secret >&2\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "release")
	err := PackageRelease(context.Background(), ReleaseOptions{Root: dir, Output: output, SHA: strings.Repeat("a", 40), Go: goTool})
	if err == nil || strings.Contains(err.Error(), "fixture-secret") {
		t.Fatalf("unexpected failure: %v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("failed build left partial output: %v", err)
	}
}
