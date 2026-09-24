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
	"sync"
)

var (
	ErrNotReady     = errors.New("asset cache is not ready")
	ErrAssetMissing = errors.New("asset is not listed in the manifest")
)

type Cache struct {
	root   string
	client *http.Client

	mu sync.RWMutex
	// verified tracks atomically installed, read-only cache files so Range
	// requests only need metadata checks after prefetch or readiness validation.
	verified   map[string]cachedFileState
	hashCached func(io.Reader) (string, error)
}

type cachedFileState struct {
	size             int64
	modificationNsec int64
}

func NewCache(root string, client *http.Client) (*Cache, error) {
	if root == "" {
		return nil, errors.New("asset cache root is required")
	}
	if client == nil {
		client = http.DefaultClient
	}
	downloadClient := *client
	if downloadClient.Transport == nil {
		downloadClient.Transport = http.DefaultTransport
	}
	downloadClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	downloadClient.Jar = nil
	return &Cache{
		root:       root,
		client:     &downloadClient,
		verified:   make(map[string]cachedFileState),
		hashCached: sha256Checksum,
	}, nil
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
	// Signed asset URLs are terminal fetch targets. The dedicated client rejects
	// redirects while retaining the caller's end-to-end download timeout.
	response, err := c.client.Do(request)
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
	if err := os.Rename(temporaryName, destination); err != nil {
		return err
	}
	return c.rememberVerified(descriptor)
}

func (c *Cache) verifyCached(descriptor Descriptor) error {
	path := c.path(descriptor.SHA256)
	info, err := os.Stat(path)
	if err != nil {
		c.forgetVerified(descriptor.SHA256)
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != descriptor.Size {
		c.forgetVerified(descriptor.SHA256)
		return errors.New("cached size does not match manifest")
	}
	state := fileState(info)
	if c.isVerified(descriptor.SHA256, state) {
		return nil
	}

	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	checksum, err := c.hashCached(file)
	if err != nil {
		return err
	}
	if checksum != descriptor.SHA256 {
		return errors.New("cached checksum does not match manifest")
	}
	verifiedInfo, err := file.Stat()
	if err != nil {
		return err
	}
	verifiedState := fileState(verifiedInfo)
	if verifiedState != state {
		return errors.New("cached asset changed during verification")
	}
	c.markVerified(descriptor.SHA256, verifiedState)
	return nil
}

func (c *Cache) rememberVerified(descriptor Descriptor) error {
	info, err := os.Stat(c.path(descriptor.SHA256))
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != descriptor.Size {
		return errors.New("cached size does not match manifest")
	}
	c.markVerified(descriptor.SHA256, fileState(info))
	return nil
}

func (c *Cache) isVerified(checksum string, state cachedFileState) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	verified, ok := c.verified[checksum]
	return ok && verified == state
}

func (c *Cache) markVerified(checksum string, state cachedFileState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.verified[checksum] = state
}

func (c *Cache) forgetVerified(checksum string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.verified, checksum)
}

func fileState(info os.FileInfo) cachedFileState {
	return cachedFileState{size: info.Size(), modificationNsec: info.ModTime().UnixNano()}
}

func sha256Checksum(reader io.Reader) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, reader); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (c *Cache) path(checksum string) string {
	return filepath.Join(c.root, "sha256", checksum[:2], checksum[2:4], checksum)
}
