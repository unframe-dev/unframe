package asset

import (
	"errors"
	"net/http"
	"os"
	"strings"
)

type AccessValidator interface {
	Validate(*http.Request, string, Manifest) error
}

type Gateway struct {
	cache     *Cache
	manifest  Manifest
	validator AccessValidator
}

func NewGateway(cache *Cache, manifest Manifest, validator AccessValidator) (*Gateway, error) {
	if cache == nil || validator == nil {
		return nil, errors.New("asset cache and access validator are required")
	}
	if err := cache.Ready(manifest); err != nil {
		return nil, err
	}
	return &Gateway{cache: cache, manifest: manifest, validator: validator}, nil
}

func (g *Gateway) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sessionID, assetID, ok := assetRequestPath(request.URL.Path)
	if !ok {
		http.NotFound(response, request)
		return
	}
	if err := g.validator.Validate(request, sessionID, g.manifest); err != nil {
		http.Error(response, "unauthorized", http.StatusUnauthorized)
		return
	}
	path, descriptor, err := g.cache.Resolve(g.manifest, assetID)
	if err != nil {
		if errors.Is(err, ErrAssetMissing) {
			http.NotFound(response, request)
			return
		}
		http.Error(response, "asset unavailable", http.StatusServiceUnavailable)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.Error(response, "asset unavailable", http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		http.Error(response, "asset unavailable", http.StatusServiceUnavailable)
		return
	}

	etag := `"` + descriptor.SHA256 + `"`
	response.Header().Set("Content-Type", descriptor.MediaType)
	response.Header().Set("ETag", etag)
	response.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	if request.Header.Get("If-None-Match") == etag {
		response.WriteHeader(http.StatusNotModified)
		return
	}
	http.ServeContent(response, request, descriptor.ID, info.ModTime(), file)
}

func assetRequestPath(path string) (string, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 4 || parts[0] != "sessions" || parts[1] == "" || parts[2] != "assets" || parts[3] == "" {
		return "", "", false
	}
	return parts[1], parts[3], true
}
