package hostops

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFunnelPreparationCopiesNativeExecutableAndKeepsSecretsExternal(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, "checkout")
	release := filepath.Join(home, "release")
	output := filepath.Join(home, "service with ' quote & ampersand")
	for _, path := range []string{filepath.Join(root, "scripts/runtime-host"), filepath.Join(root, "app/server/realtime/ops"), release} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	executable := filepath.Join(home, "admin")
	for path, data := range map[string]string{executable: "native-admin", filepath.Join(release, "runtime-host"): "native-runtime", filepath.Join(root, "scripts/runtime-host/funnel.sh"): "#!/bin/sh\n", filepath.Join(root, "app/server/realtime/ops/Caddyfile.funnel.example"): "fixture-config"} {
		if err := os.WriteFile(path, []byte(data), 0700); err != nil {
			t.Fatal(err)
		}
	}
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Fatal(err)
	}
	options := FunnelOptions{Root: root, Output: output, User: "fixture", Release: release, EnvFile: filepath.Join(home, "secret.env"), Home: home, Executable: executable}
	tools := map[string]string{"bash": bash, "tailscale": "/nix/store/fixture/bin/tailscale", "tailscaled": "/nix/store/fixture/bin/tailscaled", "caddy": "/nix/store/fixture/bin/caddy"}
	if err := prepareFunnelFiles(options, tools); err != nil {
		t.Fatal(err)
	}
	config, err := LoadFunnelConfig(filepath.Join(output, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if config.EnvFile != options.EnvFile || config.Bash != bash {
		t.Fatal(config)
	}
	data, _ := os.ReadFile(filepath.Join(output, "runtime-host-admin"))
	if string(data) != "native-admin" {
		t.Fatal("missing native admin")
	}
	start, _ := os.ReadFile(filepath.Join(output, "start.sh"))
	if !strings.Contains(string(start), "serve-funnel --config") || strings.Contains(string(start), "node") {
		t.Fatal(string(start))
	}
	for _, name := range []string{"start.sh", "install.sh"} {
		if err := exec.Command(bash, "-n", filepath.Join(output, name)).Run(); err != nil {
			t.Fatal(err)
		}
	}
	if err := prepareFunnelFiles(options, tools); err == nil {
		t.Fatal("overwrote existing deployment")
	}
	data, _ = os.ReadFile(filepath.Join(output, "runtime-host-admin"))
	if string(data) != "native-admin" {
		t.Fatal("existing deployment changed")
	}
}
func TestFunnelPreparationRemovesOnlyItsNewIncompleteOutput(t *testing.T) {
	output := filepath.Join(t.TempDir(), "service")
	if err := prepareFunnelFiles(FunnelOptions{Output: output, Executable: "/missing/admin"}, map[string]string{}); err == nil {
		t.Fatal("expected missing executable error")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("incomplete deployment remains")
	}
}
