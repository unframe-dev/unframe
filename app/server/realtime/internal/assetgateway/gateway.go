// Package assetgateway serves authorized publication assets from the Venue LAN.
package assetgateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

const capacity int64 = 4 << 30
const maximumAssetBytes int64 = 256 << 20

var hashPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type Asset struct {
	URL       string `json:"url"`
	Checksum  string `json:"checksum"`
	Size      int64  `json:"size"`
	MediaType string `json:"mediaType"`
}
type Verifier interface {
	VerifyBearer(context.Context, string, ...string) (session.Identity, error)
}
type Resolver func(context.Context, session.Identity, string) (Asset, error)

type Gateway struct {
	verifier      Verifier
	resolve       Resolver
	directory     string
	client        *http.Client
	slots         chan struct{}
	mu            sync.Mutex
	pinned        map[string]bool
	reserve       uint64
	AllowedOrigin string
}

func New(verifier Verifier, resolve Resolver, directory string, client *http.Client) *Gateway {
	// Cloud URLs are issued by the Control Plane; redirects must never change that trust boundary.
	transport := *client
	transport.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Gateway{verifier: verifier, resolve: resolve, directory: directory, client: &transport, slots: make(chan struct{}, 8), pinned: map[string]bool{}, reserve: 512 << 20}
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Add("Vary", "Origin")
		if g.AllowedOrigin == "" || origin != g.AllowedOrigin {
			http.Error(w, "origin forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag, X-Unframe-Asset-Source, X-Unframe-Cache")
	}
	if r.Method == http.MethodOptions {
		if origin == "" || (r.Header.Get("Access-Control-Request-Method") != "GET" && r.Header.Get("Access-Control-Request-Method") != "HEAD") {
			http.Error(w, "preflight forbidden", http.StatusForbidden)
			return
		}
		for _, header := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
			if name := strings.ToLower(strings.TrimSpace(header)); name != "" && name != "authorization" && name != "range" {
				http.Error(w, "preflight header forbidden", http.StatusForbidden)
				return
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Range")
		if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != "GET" && r.Method != "HEAD" {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "sessions" || parts[2] != "assets" || parts[1] == "" || parts[3] == "" || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	identity, err := g.verifier.VerifyBearer(r.Context(), r.Header.Get("Authorization"), "assets:read")
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if identity.SessionID != parts[1] {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	select {
	case g.slots <- struct{}{}:
		defer func() { <-g.slots }()
	case <-r.Context().Done():
		return
	}
	// Reauthorize even cache hits: release, participant removal, and publication changes fail closed.
	asset, err := g.resolve(r.Context(), identity, parts[3])
	if err != nil {
		http.Error(w, "asset authorization unavailable", http.StatusForbidden)
		return
	}
	file, hit, err := g.open(r.Context(), asset)
	if err != nil {
		slog.Warn("venue asset unavailable", "session_id", parts[1], "asset_id", parts[3])
		http.Error(w, "asset unavailable", http.StatusBadGateway)
		return
	}
	defer func() { _ = file.Close() }()
	current, err := g.resolve(r.Context(), identity, parts[3])
	if err != nil || current.Checksum != asset.Checksum || current.Size != asset.Size || current.MediaType != asset.MediaType {
		http.Error(w, "asset authorization changed", http.StatusForbidden)
		return
	}
	if _, err = g.verifier.VerifyBearer(r.Context(), r.Header.Get("Authorization"), "assets:read"); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(60 * time.Second))
	w.Header().Set("Content-Type", asset.MediaType)
	w.Header().Set("ETag", `"`+asset.Checksum+`"`)
	w.Header().Set("X-Unframe-Asset-Source", "venue-edge")
	state := "miss"
	if hit {
		state = "hit"
	}
	w.Header().Set("X-Unframe-Cache", state)
	slog.Info("venue asset served", "session_id", parts[1], "asset_id", parts[3], "checksum", asset.Checksum, "cache", state, "remote_address", r.RemoteAddr)
	http.ServeContent(w, r, parts[3], time.Time{}, file)
}

func (g *Gateway) open(ctx context.Context, a Asset) (*os.File, bool, error) {
	source, err := url.Parse(a.URL)
	if err != nil || source.Scheme != "https" || source.Host == "" || source.User != nil || !hashPattern.MatchString(a.Checksum) || a.Size <= 0 || a.Size > maximumAssetBytes || a.MediaType == "" {
		return nil, false, errors.New("invalid asset descriptor")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := os.MkdirAll(g.directory, 0700); err != nil {
		return nil, false, err
	}
	key := strings.TrimPrefix(a.Checksum, "sha256:")
	path := filepath.Join(g.directory, key)
	if file, err := os.Open(path); err == nil {
		valid := verify(file, a) == nil
		if valid {
			if _, err := file.Seek(0, io.SeekStart); err != nil {
				_ = file.Close()
				return nil, false, err
			}
			g.pinned[key] = true
			_ = os.Chtimes(path, time.Now(), time.Now())
			return file, true, nil
		}
		_ = file.Close()
		if err := os.Remove(path); err != nil {
			return nil, false, err
		}
	}
	if err := g.makeRoom(a.Size); err != nil {
		return nil, false, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return nil, false, err
	}
	response, err := g.client.Do(request)
	if err != nil {
		return nil, false, errors.New("asset origin unavailable")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != 200 {
		return nil, false, fmt.Errorf("asset origin status %d", response.StatusCode)
	}
	file, err := os.CreateTemp(g.directory, "partial-")
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = file.Close(); _ = os.Remove(file.Name()) }()
	if _, err = io.Copy(file, io.LimitReader(response.Body, a.Size+1)); err != nil {
		return nil, false, err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return nil, false, err
	}
	if err = verify(file, a); err != nil {
		return nil, false, err
	}
	if err = file.Sync(); err != nil {
		return nil, false, err
	}
	if err = os.Rename(file.Name(), path); err != nil {
		return nil, false, err
	}
	g.pinned[key] = true
	opened, err := os.Open(path)
	return opened, false, err
}
func verify(file *os.File, a Asset) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != a.Size {
		return errors.New("asset size mismatch")
	}
	digest := sha256.New()
	if _, err = io.Copy(digest, file); err != nil {
		return err
	}
	if "sha256:"+hex.EncodeToString(digest.Sum(nil)) != a.Checksum {
		return errors.New("asset checksum mismatch")
	}
	return nil
}
func (g *Gateway) makeRoom(size int64) error {
	entries, err := os.ReadDir(g.directory)
	if err != nil {
		return err
	}
	var total int64
	var candidates []os.FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("cache contains unexpected file")
		}
		if strings.HasPrefix(info.Name(), "partial-") {
			if err = os.Remove(filepath.Join(g.directory, info.Name())); err != nil {
				return err
			}
			continue
		}
		if !hashPattern.MatchString("sha256:" + info.Name()) {
			return errors.New("cache contains unexpected file")
		}
		total += info.Size()
		if !g.pinned[info.Name()] {
			candidates = append(candidates, info)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].ModTime().Before(candidates[j].ModTime()) })
	for {
		var stat syscall.Statfs_t
		if err = syscall.Statfs(g.directory, &stat); err != nil {
			return err
		}
		available := stat.Bavail * uint64(stat.Bsize)
		if total+size <= capacity && available >= g.reserve+uint64(size) {
			return nil
		}
		if len(candidates) == 0 {
			return errors.New("cache capacity or disk reserve exhausted")
		}
		oldest := candidates[0]
		candidates = candidates[1:]
		if err = os.Remove(filepath.Join(g.directory, oldest.Name())); err != nil {
			return err
		}
		total -= oldest.Size()
	}
}
