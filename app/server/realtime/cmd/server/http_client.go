package main

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net/http"
	"os"
)

func newHTTPClient(caFile string) (*http.Client, error) {
	if caFile == "" {
		return http.DefaultClient, nil
	}
	certificates, err := os.ReadFile(caFile)
	if err != nil {
		return nil, errors.New("read SSL_CERT_FILE failed")
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		return nil, errors.New("load system certificate pool failed")
	}
	if !roots.AppendCertsFromPEM(certificates) {
		return nil, errors.New("SSL_CERT_FILE contains no valid certificates")
	}
	// macOS's system verifier does not load SSL_CERT_FILE itself.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if transport.TLSClientConfig == nil {
		transport.TLSClientConfig = &tls.Config{RootCAs: roots}
	} else {
		transport.TLSClientConfig = transport.TLSClientConfig.Clone()
		transport.TLSClientConfig.RootCAs = roots
	}
	return &http.Client{Transport: transport}, nil
}
