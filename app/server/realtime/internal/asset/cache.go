package asset

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
)

var (
	ErrNotReady     = errors.New("asset cache is not ready")
	ErrAssetMissing = errors.New("asset is not listed in the manifest")
)

type Cache struct {
	root      string
	transport http.RoundTripper
}

func NewCache(root string, client *http.Client) (*Cache, error) {
	if root == "" {
		return nil, errors.New("asset cache root is required")
	}
	if client == nil {
		client = http.DefaultClient
	}
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &Cache{root: root, transport: transport}, nil
}

func (c *Cache) Prefetch(ctx context.Context, manifest Manifest) error {
	if err := manifest.Validate(); err != nil {
		return err
	}
	for _, descriptor := range manifest.Assets {
		if c.verifyCached(descriptor) == nil {
			continue
		}
		if err := c.fetch(ctx, descriptor); err != nil {
			return fmt.Errorf("prefetch asset %q: %w", descriptor.ID, err)
		}
	}
	return nil
}

func (c *Cache) Ready(manifest Manifest) error {
	if err := manifest.Validate(); err != nil {
		return err
	}
	for _, descriptor := range manifest.Assets {
		if err := c.verifyCached(descriptor); err != nil {
			return fmt.Errorf("%w: asset %q: %v", ErrNotReady, descriptor.ID, err)
		}
	}
	return nil
}

func (c *Cache) Resolve(manifest Manifest, assetID string) (string, Descriptor, error) {
	if err := manifest.Validate(); err != nil {
		return "", Descriptor{}, err
	}
	for _, descriptor := range manifest.Assets {
		if descriptor.ID != assetID {
			continue
		}
		if err := c.verifyCached(descriptor); err != nil {
			return "", Descriptor{}, fmt.Errorf("%w: asset %q: %v", ErrNotReady, descriptor.ID, err)
		}
		return c.path(descriptor.SHA256), descriptor, nil
	}
	return "", Descriptor{}, ErrAssetMissing
}

func (c *Cache) fetch(ctx context.Context, descriptor Descriptor) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, descriptor.SourceURL, nil)
	if err != nil {
		return err
	}
	// Signed asset URLs are terminal fetch targets. RoundTrip intentionally
	// bypasses http.Client redirect handling so a signed HTTPS URL cannot
	// redirect the Edge to another origin or downgrade to plaintext HTTP.
	response, err := c.transport.RoundTrip(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("source returned HTTP %d", response.StatusCode)
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != descriptor.MediaType {
		return fmt.Errorf("media type %q does not match %q", mediaType, descriptor.MediaType)
	}

	destination := c.path(descriptor.SHA256)
	directory := filepath.Dir(destination)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".prefetch-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer func() { _ = os.Remove(temporaryName) }()

	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(temporary, hash), io.LimitReader(response.Body, descriptor.Size+1))
	if copyErr != nil {
		_ = temporary.Close()
		return copyErr
	}
	if written != descriptor.Size {
		_ = temporary.Close()
		return fmt.Errorf("size %d does not match %d", written, descriptor.Size)
	}
	if checksum := hex.EncodeToString(hash.Sum(nil)); checksum != descriptor.SHA256 {
		_ = temporary.Close()
		return fmt.Errorf("checksum %q does not match manifest", checksum)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Chmod(0o440); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, destination)
}

func (c *Cache) verifyCached(descriptor Descriptor) error {
	file, err := os.Open(c.path(descriptor.SHA256))
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != descriptor.Size {
		return errors.New("cached size does not match manifest")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != descriptor.SHA256 {
		return errors.New("cached checksum does not match manifest")
	}
	return nil
}

func (c *Cache) path(checksum string) string {
	return filepath.Join(c.root, "sha256", checksum[:2], checksum[2:4], checksum)
}
