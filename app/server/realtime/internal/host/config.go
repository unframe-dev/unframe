package host

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Capacity        int
	Drain           bool
	BrowserOrigins  []string
	ControlPlaneURL string
	ServiceIdentity string
	RuntimeID       string
	Endpoint        string
	ListenAddr      string
	Issuer          string
	Audience        string
	JWKSURL         string
	CAFile          string
}

func httpsURL(value string, origin bool) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (!origin || value == "https://"+u.Host)
}
func LoadConfig(getenv func(string) string) (Config, error) {
	c := Config{
		Drain:           getenv("REALTIME_HOST_DRAIN") == "true",
		ControlPlaneURL: getenv("REALTIME_CONTROL_PLANE_URL"),
		ServiceIdentity: getenv("REALTIME_SERVICE_IDENTITY"),
		RuntimeID:       getenv("REALTIME_RUNTIME_ID"),
		Endpoint:        getenv("REALTIME_RUNTIME_ENDPOINT"),
		ListenAddr:      getenv("REALTIME_LISTEN_ADDR"),
		Issuer:          getenv("REALTIME_ISSUER"),
		Audience:        getenv("REALTIME_AUDIENCE"),
		JWKSURL:         getenv("REALTIME_JWKS_URL"),
		CAFile:          getenv("SSL_CERT_FILE"),
	}
	bad := errors.New("runtime host configuration is invalid")
	c.Capacity, _ = strconv.Atoi(getenv("REALTIME_HOST_CAPACITY"))
	if c.Capacity < 1 || c.Capacity > 256 || !httpsURL(c.ControlPlaneURL, true) || !httpsURL(c.Endpoint, true) || !httpsURL(c.Issuer, false) || !httpsURL(c.JWKSURL, false) || len(c.ServiceIdentity) < 32 || strings.ContainsAny(c.ServiceIdentity, "\r\n") || !regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`).MatchString(c.RuntimeID) || c.Audience == "" {
		return Config{}, bad
	}
	_, port, err := net.SplitHostPort(c.ListenAddr)
	if err != nil {
		return Config{}, bad
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return Config{}, bad
	}
	for _, origin := range strings.Split(getenv("REALTIME_BROWSER_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			if !httpsURL(origin, true) {
				return Config{}, bad
			}
			c.BrowserOrigins = append(c.BrowserOrigins, origin)
		}
	}
	if value := getenv("REALTIME_HOST_DRAIN"); value != "" && value != "true" && value != "false" {
		return Config{}, bad
	}
	return c, nil
}
func (c Config) HTTPClient() (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if c.CAFile != "" {
		pem, err := os.ReadFile(c.CAFile)
		if err != nil {
			return nil, errors.New("runtime host CA file could not be read")
		}
		roots, err := x509.SystemCertPool()
		if err != nil {
			return nil, err
		}
		if !roots.AppendCertsFromPEM(pem) {
			return nil, errors.New("runtime host CA file contains no certificates")
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	}
	return &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, nil
}
