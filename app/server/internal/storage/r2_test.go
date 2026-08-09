package storage

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestR2PresignsPathStylePutAndGet(t *testing.T) {
	r2, err := NewR2(R2Config{
		Endpoint:        "https://account-id.r2.cloudflarestorage.com",
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
		Bucket:          "unframe-assets",
	})
	if err != nil {
		t.Fatal(err)
	}

	put, err := r2.PresignPut(context.Background(), PutRequest{
		Key:         "assets/example.png",
		ContentType: "image/png",
		SizeBytes:   50 * 1024 * 1024,
		Expires:     15 * time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertSignedURL(t, put.URL, "PutObject", "/unframe-assets/assets/example.png", "900")
	parsedPut, err := url.Parse(put.URL)
	if err != nil {
		t.Fatal(err)
	}
	if signedHeaders := parsedPut.Query().Get("X-Amz-SignedHeaders"); !strings.Contains(signedHeaders, "content-length") {
		t.Fatalf("content length is not signed: %q", signedHeaders)
	}

	get, err := r2.PresignGet(context.Background(), GetRequest{
		Key:     "assets/example.png",
		Expires: 5 * time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertSignedURL(t, get.URL, "GetObject", "/unframe-assets/assets/example.png", "300")
}

func TestR2RejectsIncompleteConfig(t *testing.T) {
	if _, err := NewR2(R2Config{}); err == nil {
		t.Fatal("expected incomplete R2 config to fail")
	}
}

func assertSignedURL(t *testing.T, rawURL, operation, path, expires string) {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != path {
		t.Fatalf("path = %q, want %q", parsed.Path, path)
	}
	if parsed.Host != "account-id.r2.cloudflarestorage.com" {
		t.Fatalf("host = %q, want custom R2 endpoint", parsed.Host)
	}
	if parsed.Query().Get("X-Amz-Expires") != expires {
		t.Fatalf("expires = %q, want %q", parsed.Query().Get("X-Amz-Expires"), expires)
	}
	if parsed.Query().Get("X-Amz-Signature") == "" {
		t.Fatal("missing signature")
	}
	if got := parsed.Query().Get("x-id"); got != operation {
		t.Fatalf("operation = %q, want %q", got, operation)
	}
}
