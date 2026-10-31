package hostops

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFunnelHostnameAndVacancy(t *testing.T) {
	host, err := FunnelHostname([]byte(`{"BackendState":"Running","Self":{"DNSName":"fixture.example.ts.net."}}`))
	if err != nil || host != "fixture.example.ts.net" {
		t.Fatalf("hostname = %q, %v", host, err)
	}
	for _, data := range []string{`{}`, `{"Self":{"DNSName":"bad/name"}}`, `invalid`} {
		if _, err := FunnelHostname([]byte(data)); err == nil {
			t.Errorf("accepted %s", data)
		}
	}
	if err := CheckFunnelVacant([]byte(`{"AllowFunnel":{"fixture.example.ts.net:443":true}}`)); err != nil {
		t.Fatal(err)
	}
	if err := CheckFunnelVacant([]byte(`{"TCP":{"443":{"TCPForward":"127.0.0.1:8443"}}}`)); err == nil {
		t.Fatal("accepted existing listener")
	}
}

func TestFunnelOnlyRecoversOwnedPublication(t *testing.T) {
	for _, sample := range []struct {
		source string
		owned  bool
	}{
		{`{"TCP":{"443":{"TCPForward":"127.0.0.1:8443"}},"AllowFunnel":{"fixture.example.ts.net:443":true}}`, true},
		{`{"TCP":{"443":{"TCPForward":"127.0.0.1:9999"}}}`, false},
		{`{"TCP":{"443":{"TCPForward":"127.0.0.1:8443"}},"Web":{"unrelated":{}}}`, false},
		{`{"TCP":{"443":{"TCPForward":"127.0.0.1:8443"}},"AllowFunnel":{"other.ts.net:443":true}}`, false},
	} {
		got, err := ownsFunnelPublication([]byte(sample.source), "fixture.example.ts.net")
		if err != nil || got != sample.owned {
			t.Errorf("%s = %v, %v", sample.source, got, err)
		}
	}
}

func funnelFixture(t *testing.T, serve string) (FunnelConfig, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(dir, "events")
	sleep, err := exec.LookPath("sleep")
	if err != nil {
		t.Fatal(err)
	}
	script := func(name, body string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"+strings.ReplaceAll(body, "sleep 0.05", sleep+" 0.05")), 0700); err != nil {
			t.Fatal(err)
		}
		return path
	}
	daemon := script("tailscaled", "printf 'daemon-start\\n' >> '"+log+"'\ntrap \"printf 'daemon-stop\\\\n' >> '"+log+"'; exit 0\" TERM INT\nwhile :; do sleep 0.05; done\n")
	cli := script("tailscale", "shift\ncase \"$*\" in\n 'status --json') printf '%s' '{\"BackendState\":\"Running\",\"Self\":{\"DNSName\":\"fixture.example.ts.net.\"}}';;\n 'serve status --json') printf '%s' '"+serve+"';;\n 'funnel --tcp=443 off') printf 'funnel-off\\n' >> '"+log+"';;\nesac\n")
	script("funnel.sh", "printf 'funnel-start\\n' >> '"+log+"'\n[ -n \"$RUNTIME_HOST_ADMIN\" ] || exit 9\ntrap \"printf 'funnel-stop\\\\n' >> '"+log+"'; exit 0\" TERM INT\nwhile :; do sleep 0.05; done\n")
	env := filepath.Join(dir, "environment")
	if err := os.WriteFile(env, []byte("REALTIME_SERVICE_IDENTITY=fixture-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "launchd-owner.json"), []byte(`{"label":"me.un-fra.realtime-funnel","target":"127.0.0.1:8443"}`), 0600); err != nil {
		t.Fatal(err)
	}
	return FunnelConfig{Directory: dir, Home: dir, EnvFile: env, StateDirectory: dir, Socket: filepath.Join(dir, "socket"), Bash: "/bin/sh", Tailscale: cli, Tailscaled: daemon, Caddy: filepath.Join(dir, "caddy")}, log
}

func TestFunnelStopsPublicationBeforeDaemon(t *testing.T) {
	cfg, log := funnelFixture(t, `{"TCP":{"443":{"TCPForward":"127.0.0.1:8443"}}}`)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- ServeFunnel(ctx, cfg) }()
	deadline := time.After(5 * time.Second)
	for {
		data, _ := os.ReadFile(log)
		if strings.Contains(string(data), "funnel-start") {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("exited early: %v", err)
		case <-deadline:
			t.Fatal("start timeout")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown timeout")
	}
	data, _ := os.ReadFile(log)
	events := string(data)
	if !strings.Contains(events, "funnel-off") || !strings.Contains(events, "funnel-stop") || strings.Index(events, "funnel-stop") > strings.Index(events, "daemon-stop") {
		t.Fatal(events)
	}
}

func TestFunnelRejectsUnrelatedPublication(t *testing.T) {
	cfg, log := funnelFixture(t, `{"Web":{"unrelated":{}}}`)
	if err := ServeFunnel(context.Background(), cfg); err == nil || !strings.Contains(err.Error(), "unrecognized Serve") {
		t.Fatalf("error = %v", err)
	}
	data, _ := os.ReadFile(log)
	if strings.Contains(string(data), "funnel-start") || strings.Contains(string(data), "funnel-off") || !strings.Contains(string(data), "daemon-stop") {
		t.Fatal(string(data))
	}
}

func TestFunnelRejectsPublicEnvironment(t *testing.T) {
	cfg, log := funnelFixture(t, `{}`)
	if err := os.Chmod(cfg.EnvFile, 0644); err != nil {
		t.Fatal(err)
	}
	if err := ServeFunnel(context.Background(), cfg); err == nil {
		t.Fatal("accepted public environment")
	}
	if _, err := os.Stat(log); !os.IsNotExist(err) {
		t.Fatal("process started")
	}
}

func TestFunnelStopsTheOtherChildAfterUnexpectedExit(t *testing.T) {
	for _, failure := range []string{"daemon", "funnel"} {
		t.Run(failure, func(t *testing.T) {
			cfg, log := funnelFixture(t, `{}`)
			path := cfg.Tailscaled
			if failure == "funnel" {
				path = filepath.Join(cfg.Directory, "funnel.sh")
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			sleep, err := exec.LookPath("sleep")
			if err != nil {
				t.Fatal(err)
			}
			data = []byte(strings.ReplaceAll(string(data), "while :; do "+sleep+" 0.05; done", sleep+" 0.2; exit 7"))
			if err = os.WriteFile(path, data, 0700); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err = ServeFunnel(ctx, cfg); err == nil {
				t.Fatal("unexpected child exit succeeded")
			}
			data, _ = os.ReadFile(log)
			expected := "daemon-stop"
			if failure == "daemon" {
				expected = "funnel-stop"
			}
			if !strings.Contains(string(data), expected) {
				t.Fatal(string(data))
			}
		})
	}
}

func TestFunnelWaitsForDaemonReadiness(t *testing.T) {
	cfg, log := funnelFixture(t, `{}`)
	data, err := os.ReadFile(cfg.Tailscale)
	if err != nil {
		t.Fatal(err)
	}
	// The fake daemon boundary stays unauthenticated throughout startup.
	data = []byte(strings.ReplaceAll(string(data), `"BackendState":"Running"`, `"BackendState":"NeedsLogin"`))
	if err = os.WriteFile(cfg.Tailscale, data, 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err = ServeFunnel(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(log)
	if strings.Contains(string(data), "funnel-start") || !strings.Contains(string(data), "daemon-stop") {
		t.Fatal(string(data))
	}
}

func TestFunnelConfigurationRejectsMissingOrRelativeCaddy(t *testing.T) {
	cfg, _ := funnelFixture(t, `{}`)
	path := filepath.Join(cfg.Directory, "config.json")
	for _, caddy := range []string{"", "relative/caddy"} {
		cfg.Caddy = caddy
		data, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = LoadFunnelConfig(path); err == nil {
			t.Errorf("accepted caddy path %q", caddy)
		}
	}
}
