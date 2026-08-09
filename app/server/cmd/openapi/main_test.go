package main

import (
	"bytes"
	"testing"
)

func TestGenerateIsDeterministic(t *testing.T) {
	first, err := generate()
	if err != nil {
		t.Fatalf("first generation: %v", err)
	}
	second, err := generate()
	if err != nil {
		t.Fatalf("second generation: %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("OpenAPI output is not deterministic")
	}

	for _, expected := range [][]byte{
		[]byte("openapi: 3.1.0"),
		[]byte("/health:"),
		[]byte("/assets/init:"),
		[]byte("/presentations:"),
		[]byte("/presentations/{id}:"),
		[]byte("/presentations/{id}/manifest:"),
		[]byte("HealthResponse:"),
		[]byte("ErrorResponse:"),
		[]byte("StoredSlideContent:"),
		[]byte("SlideContent:"),
		[]byte("ManifestAsset:"),
		[]byte("maximum: 52428800"),
		[]byte("minProperties: 1"),
	} {
		if !bytes.Contains(first, expected) {
			t.Fatalf("OpenAPI output does not contain %q", expected)
		}
	}
}
