package hostops

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"
)

type ReleaseOptions struct {
	Root, Output, SHA, Go string
}

// PackageRelease creates the artifact consumed by the Runtime Host updater.
func PackageRelease(ctx context.Context, options ReleaseOptions) (err error) {
	if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(options.SHA) {
		return errors.New("a full commit SHA is required")
	}
	if !filepath.IsAbs(options.Output) || !filepath.IsAbs(options.Root) {
		return errors.New("release and repository paths must be absolute")
	}
	if err = os.Mkdir(options.Output, 0700); err != nil {
		return errors.New("an absolute new output directory is required")
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(options.Output)
		}
	}()
	goTool := options.Go
	if goTool == "" {
		goTool = "go"
	}
	buildCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(buildCtx, goTool, "-C", filepath.Join(options.Root, "app/server/realtime"), "build", "-trimpath", "-o", filepath.Join(options.Output, "runtime-host"), "./cmd/runtime-host")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS=darwin", "GOARCH=arm64")
	if cmd.Run() != nil {
		return errors.New("runtime host release build failed")
	}
	binary, err := os.Open(filepath.Join(options.Output, "runtime-host"))
	if err != nil {
		return err
	}
	digest := sha256.New()
	_, copyErr := io.Copy(digest, binary)
	closeErr := binary.Close()
	if err = errors.Join(copyErr, closeErr); err != nil {
		return err
	}
	manifest := struct {
		SchemaVersion int    `json:"schemaVersion"`
		Repository    string `json:"repository"`
		SHA           string `json:"sha"`
		Platform      string `json:"platform"`
		Arch          string `json:"arch"`
		SHA256        string `json:"sha256"`
	}{1, "unframe-dev/unframe", options.SHA, "darwin", "arm64", hex.EncodeToString(digest.Sum(nil))}
	data, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(options.Output, "manifest.json"), append(data, '\n'), 0600)
}
