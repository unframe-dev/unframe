package main

import (
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPClientTrustsAdditionalCAOnlyWhenConfigured(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	certificate, err := x509.ParseCertificate(server.TLS.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	caFile := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "system trust rejects local CA", true: "additional CA permits TLS"}[configured], func(t *testing.T) {
			path := ""
			if configured {
				path = caFile
			}
			client, err := newHTTPClient(path)
			if err != nil {
				t.Fatal(err)
			}
			defer client.CloseIdleConnections()
			response, err := client.Get(server.URL)
			if !configured {
				if err == nil {
					_ = response.Body.Close()
					t.Fatal("unconfigured local CA was trusted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			if response.StatusCode != http.StatusNoContent {
				t.Fatalf("status = %d", response.StatusCode)
			}
			wrongHost := strings.Replace(server.URL, "127.0.0.1", "localhost", 1)
			if response, err := client.Get(wrongHost); err == nil {
				_ = response.Body.Close()
				t.Fatal("additional CA bypassed hostname verification")
			}
		})
	}
}

func TestHTTPClientRejectsInvalidCAFile(t *testing.T) {
	invalid := filepath.Join(t.TempDir(), "invalid.pem")
	if err := os.WriteFile(invalid, []byte("invalid PEM"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(t.TempDir(), "absent.pem"), invalid} {
		if _, err := newHTTPClient(path); err == nil {
			t.Fatal("invalid CA configuration was accepted")
		}
	}
}

func TestHTTPClientWithoutAdditionalCAUsesDefaultClient(t *testing.T) {
	client, err := newHTTPClient("")
	if err != nil {
		t.Fatal(err)
	}
	if client != http.DefaultClient {
		t.Fatal("default client was replaced")
	}
}
