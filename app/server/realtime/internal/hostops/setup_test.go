package hostops

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdaterPreparationCreatesNativeManualAndPeriodicCommands(t *testing.T) {
	home := t.TempDir()
	deployment := filepath.Join(home, "Funnel")
	output := filepath.Join(home, "Updater")
	if err := os.MkdirAll(filepath.Join(deployment, "release"), 0700); err != nil {
		t.Fatal(err)
	}
	environment := filepath.Join(home, "runtime.env")
	for path, data := range map[string]string{
		environment: "REALTIME_SERVICE_IDENTITY='fixture-secret'\n",
		filepath.Join(deployment, "release/runtime-host"): "existing-runtime",
		filepath.Join(deployment, "config.json"):          `{"home":` + strconvJSON(home) + `,"envFile":` + strconvJSON(environment) + `}`,
	} {
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	executable := filepath.Join(home, "admin")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	options := SetupOptions{Output: output, DeploymentDirectory: deployment, Home: home, Executable: executable}
	if err := prepareUpdaterFiles(options, "/fixture/gh"); err != nil {
		t.Fatal(err)
	}
	for _, sample := range []struct {
		args []string
		last string
	}{{nil, "--force"}, {[]string{"--auto"}, filepath.Join(output, "config.json")}, {[]string{"--check"}, "--check"}} {
		bash, err := exec.LookPath("bash")
		if err != nil {
			t.Fatal(err)
		}
		data, err := exec.Command(bash, append([]string{filepath.Join(output, "update")}, sample.args...)...).Output()
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		if lines[0] != "update" || lines[len(lines)-1] != sample.last {
			t.Fatalf("args = %q", data)
		}
	}
	data, err := os.ReadFile(filepath.Join(output, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err = json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if _, exists := config["node"]; exists {
		t.Fatal("Node remains in config")
	}
	if config["repository"] != "unframe-dev/unframe" || config["workflow"] != "ci.yml" {
		t.Fatal(config)
	}
	plist, err := os.ReadFile(filepath.Join(output, updaterLabel+".plist"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(plist), "<integer>600</integer>") || !strings.Contains(string(plist), "--auto") {
		t.Fatal(string(plist))
	}
	if err = exec.Command("bash", "-n", filepath.Join(output, "install.sh")).Run(); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(environment)
	if string(data) != "REALTIME_SERVICE_IDENTITY='fixture-secret'\n" {
		t.Fatal("setup changed environment")
	}
	if err = prepareUpdaterFiles(options, "/fixture/gh"); err == nil {
		t.Fatal("overwrote existing deployment")
	}
}
func strconvJSON(s string) string { data, _ := json.Marshal(s); return string(data) }
func TestFindPinnedToolPreservesMulticallName(t *testing.T) {
	directory := t.TempDir()
	daemon := filepath.Join(directory, "tailscaled")
	if err := os.WriteFile(daemon, []byte("#!/bin/sh\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(daemon, filepath.Join(directory, "tailscale")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory)
	path, err := deployFindTool("tailscale")
	if err != nil || filepath.Base(path) != "tailscale" {
		t.Fatalf("tool = %q, %v", path, err)
	}
}
func TestNixRootPreservesMulticallInvocation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nix")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n[ \"${0##*/}\" = nix-store ] || exit 9\nprintf '%s' \"$5\" > \"$2\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(path, filepath.Join(dir, "nix-store")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	root := filepath.Join(dir, "root")
	if err := deployAddRoot(context.Background(), root, "/nix/store/fixture"); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(root)
	if string(data) != "/nix/store/fixture" {
		t.Fatal(string(data))
	}
}
