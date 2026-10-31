package hostops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type FunnelOptions struct{ Root, Output, User, Release, EnvFile, Home, Executable string }

func deployEnvironment(base []string, values map[string]string) []string {
	result := make([]string, 0, len(base)+len(values))
	for _, value := range base {
		key, _, _ := strings.Cut(value, "=")
		if _, exists := values[key]; !exists {
			result = append(result, value)
		}
	}
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result
}
func deployPrivatePath(path string, uid int, regular bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSymlink != 0 || int(owner.Uid) != uid || info.Mode().Perm()&0077 != 0 || (regular && !info.Mode().IsRegular()) {
		return errors.New("path must be private and owned by the service user")
	}
	return nil
}
func deployCopy(source, dest string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = input.Close() }()
	output, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
func deployJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}
func deployShell(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
func deployXML(value string) string   { return html.EscapeString(value) }
func deployRun(ctx context.Context, file string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, file, args...)
	cmd.Env = deployEnvironment(os.Environ(), map[string]string{"GH_HOST": "github.com"})
	output, err := cmd.Output()
	if err != nil {
		return nil, errors.New("deployment command failed; check local tools and authentication")
	}
	return output, nil
}
func deployFindTool(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		return "", err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", err
	}
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	// Multicall tools use argv[0] to choose the client or daemon entry point.
	executable := filepath.Join(filepath.Dir(target), filepath.Base(path))
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil || resolved != target {
		return "", fmt.Errorf("cannot preserve the invocation name of %s", name)
	}
	return executable, nil
}
func deployStore(path string) (string, error) {
	if !strings.HasPrefix(path, "/nix/store/") {
		return "", errors.New("deployment tools must come from the pinned Nix environment")
	}
	parts := strings.Split(strings.TrimPrefix(path, "/nix/store/"), "/")
	if parts[0] == "" {
		return "", errors.New("invalid Nix store path")
	}
	return "/nix/store/" + parts[0], nil
}
func deployAddRoot(ctx context.Context, root, store string) error {
	// Preserve the nix-store symlink because the invocation name selects its CLI.
	executable, err := exec.LookPath("nix-store")
	if err != nil {
		return err
	}
	_, err = deployRun(ctx, executable, "--add-root", root, "--indirect", "-r", store)
	return err
}
func deployExecutable(value string) (string, error) {
	if value == "" {
		return os.Executable()
	}
	if !filepath.IsAbs(value) {
		return "", errors.New("executable path must be absolute")
	}
	return value, nil
}

func PrepareFunnel(ctx context.Context, options FunnelOptions) (err error) {
	if runtime.GOOS != "darwin" {
		return errors.New("prepare Funnel as the service user on macOS")
	}
	if options.Home == "" {
		options.Home = os.Getenv("HOME")
	}
	if options.Release == "" {
		options.Release = filepath.Join(options.Root, ".unframe/realtime-release")
	}
	if options.EnvFile == "" {
		options.EnvFile = filepath.Join(options.Home, ".config/unframe/runtime-host.env")
	}
	if !regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_-]*$`).MatchString(options.User) {
		return errors.New("invalid service user")
	}
	for _, path := range []string{options.Root, options.Output, options.Release, options.EnvFile, options.Home} {
		if !filepath.IsAbs(path) {
			return errors.New("funnel preparation paths must be absolute")
		}
	}
	uidData, err := deployRun(ctx, "/usr/bin/id", "-u", options.User)
	if err != nil {
		return err
	}
	uid, err := strconv.Atoi(strings.TrimSpace(string(uidData)))
	if err != nil || uid == 0 || uid != os.Getuid() {
		return errors.New("prepare as the non-root service user")
	}
	homeData, err := deployRun(ctx, "/usr/bin/dscl", ".", "-read", "/Users/"+options.User, "NFSHomeDirectory")
	if err != nil {
		return err
	}
	registeredHome := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(homeData)), "NFSHomeDirectory:"))
	if registeredHome != options.Home {
		return errors.New("HOME must match the service user's home directory")
	}
	state := filepath.Join(options.Home, ".config/unframe/funnel")
	for _, path := range []string{options.EnvFile, state} {
		if err = deployPrivatePath(path, uid, false); err != nil {
			return err
		}
	}
	marker := filepath.Join(state, "launchd-owner.json")
	if data, readErr := os.ReadFile(marker); readErr == nil {
		var ownership struct{ Label, Target string }
		if json.Unmarshal(data, &ownership) != nil || ownership.Label != funnelLabel || ownership.Target != "127.0.0.1:8443" {
			return errors.New("existing Tailscale state belongs to another deployment")
		}
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	info, err := os.Stat(filepath.Join(options.Release, "runtime-host"))
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
		return errors.New("build the Realtime release before preparing Funnel launchd")
	}
	tools := map[string]string{}
	for _, name := range []string{"bash", "tailscale", "tailscaled", "caddy"} {
		tools[name], err = deployFindTool(name)
		if err != nil {
			return err
		}
		if _, err = deployStore(tools[name]); err != nil {
			return err
		}
	}
	if err = prepareFunnelFiles(options, tools); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(options.Output)
		}
	}()
	if _, err = deployRun(ctx, "/usr/bin/plutil", "-lint", filepath.Join(options.Output, funnelLabel+".plist")); err != nil {
		return err
	}
	for name, path := range tools {
		store, _ := deployStore(path)
		if err = deployAddRoot(ctx, filepath.Join(options.Output, "nix-roots", name), store); err != nil {
			return err
		}
	}
	if err = deployJSON(marker, map[string]string{"label": funnelLabel, "target": "127.0.0.1:8443"}); err != nil {
		return err
	}
	fmt.Printf("Prepared Funnel service: %s\nInstall: sudo /bin/bash %s\n", options.Output, deployShell(filepath.Join(options.Output, "install.sh")))
	return nil
}
func prepareFunnelFiles(options FunnelOptions, tools map[string]string) (err error) {
	if err = os.MkdirAll(filepath.Dir(options.Output), 0700); err != nil {
		return err
	}
	if err = os.Mkdir(options.Output, 0700); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(options.Output)
		}
	}()
	for _, directory := range []string{"bin", "release", "logs", "nix-roots"} {
		if err = os.Mkdir(filepath.Join(options.Output, directory), 0700); err != nil {
			return err
		}
	}
	for name, path := range tools {
		if err = os.Symlink(path, filepath.Join(options.Output, "bin", name)); err != nil {
			return err
		}
	}
	for _, name := range []string{"stdout.log", "stderr.log"} {
		if err = os.WriteFile(filepath.Join(options.Output, "logs", name), nil, 0600); err != nil {
			return err
		}
	}
	executable, err := deployExecutable(options.Executable)
	if err != nil {
		return err
	}
	for _, copy := range []struct {
		from, to string
		mode     os.FileMode
	}{
		{executable, "runtime-host-admin", 0700},
		{filepath.Join(options.Release, "runtime-host"), "release/runtime-host", 0700},
		{filepath.Join(options.Root, "scripts/runtime-host/funnel.sh"), "funnel.sh", 0700},
		{filepath.Join(options.Root, "app/server/realtime/ops/Caddyfile.funnel.example"), "Caddyfile", 0600},
	} {
		if err = deployCopy(copy.from, filepath.Join(options.Output, copy.to), copy.mode); err != nil {
			return err
		}
	}
	state := filepath.Join(options.Home, ".config/unframe/funnel")
	config := FunnelConfig{Directory: options.Output, Home: options.Home, EnvFile: options.EnvFile, StateDirectory: state, Socket: filepath.Join(state, "tailscaled.sock"), Bash: tools["bash"], Tailscale: tools["tailscale"], Tailscaled: tools["tailscaled"], Caddy: tools["caddy"]}
	if err = deployJSON(filepath.Join(options.Output, "config.json"), config); err != nil {
		return err
	}
	start := fmt.Sprintf("#!%s\nset -euo pipefail\numask 077\nexec %s serve-funnel --config %s\n", tools["bash"], deployShell(filepath.Join(options.Output, "runtime-host-admin")), deployShell(filepath.Join(options.Output, "config.json")))
	if err = os.WriteFile(filepath.Join(options.Output, "start.sh"), []byte(start), 0700); err != nil {
		return err
	}
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>%s</string>
<key>UserName</key><string>%s</string>
<key>ProgramArguments</key><array><string>%s</string></array>
<key>WorkingDirectory</key><string>%s</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>%s</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>Umask</key><integer>63</integer>
<key>AbandonProcessGroup</key><false/>
<key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>30</integer>
<key>StandardOutPath</key><string>%s</string>
<key>StandardErrorPath</key><string>%s</string>
</dict></plist>
`, funnelLabel, deployXML(options.User), deployXML(filepath.Join(options.Output, "start.sh")), deployXML(options.Output), deployXML(options.Home), deployXML(filepath.Join(options.Output, "logs/stdout.log")), deployXML(filepath.Join(options.Output, "logs/stderr.log")))
	if err = os.WriteFile(filepath.Join(options.Output, funnelLabel+".plist"), []byte(plist), 0600); err != nil {
		return err
	}
	installer := fmt.Sprintf(`#!/bin/bash
set -euo pipefail
[ "$(/usr/bin/id -u)" = 0 ] || { echo 'Run this installer with sudo.' >&2; exit 1; }
source_plist=%s
destination=%s
/usr/bin/plutil -lint "$source_plist" >/dev/null
[ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$source_plist")" = %s ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :UserName' "$source_plist")" = %s ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$source_plist")" = %s ]
if [ -e "$destination" ] || [ -L "$destination" ]; then
 [ ! -L "$destination" ] && [ -f "$destination" ] || { echo 'Unexpected existing launchd path.' >&2; exit 1; }
 [ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$destination")" = %s ]
 [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$destination")" = %s ]
fi
stage=$(/usr/bin/mktemp /Library/LaunchDaemons/.unframe-funnel.XXXXXXXX)
trap '/bin/rm -f "$stage"' EXIT
/bin/cp "$source_plist" "$stage"
/usr/sbin/chown root:wheel "$stage"
/bin/chmod 644 "$stage"
/bin/launchctl bootout system/%s 2>/dev/null || true
/bin/mv -f "$stage" "$destination"
/bin/launchctl bootstrap system "$destination"
/bin/launchctl print system/%s
`, deployShell(filepath.Join(options.Output, funnelLabel+".plist")), deployShell("/Library/LaunchDaemons/"+funnelLabel+".plist"), deployShell(funnelLabel), deployShell(options.User), deployShell(filepath.Join(options.Output, "start.sh")), deployShell(funnelLabel), deployShell(filepath.Join(options.Output, "start.sh")), funnelLabel, funnelLabel)
	return os.WriteFile(filepath.Join(options.Output, "install.sh"), []byte(installer), 0700)
}
