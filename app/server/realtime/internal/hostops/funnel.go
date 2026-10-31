package hostops

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const funnelLabel = "me.un-fra.realtime-funnel"

// FunnelConfig describes a self-contained local Funnel service deployment.
type FunnelConfig struct {
	Directory      string `json:"directory"`
	Home           string `json:"home"`
	EnvFile        string `json:"envFile"`
	StateDirectory string `json:"stateDirectory"`
	Socket         string `json:"socket"`
	Bash           string `json:"bash"`
	Tailscale      string `json:"tailscale"`
	Tailscaled     string `json:"tailscaled"`
	Caddy          string `json:"caddy"`
}

func LoadFunnelConfig(path string) (FunnelConfig, error) {
	var cfg FunnelConfig
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err = json.Unmarshal(data, &cfg); err != nil {
		return cfg, errors.New("invalid Funnel configuration")
	}
	if err = cfg.validate(); err != nil {
		return cfg, err
	}
	return cfg, nil
}
func (cfg FunnelConfig) validate() error {
	for _, path := range []string{cfg.Directory, cfg.Home, cfg.EnvFile, cfg.StateDirectory, cfg.Socket, cfg.Bash, cfg.Tailscale, cfg.Tailscaled, cfg.Caddy} {
		if !filepath.IsAbs(path) {
			return errors.New("funnel configuration paths must be absolute")
		}
	}
	return nil
}

func FunnelHostname(data []byte) (string, error) {
	var status struct {
		BackendState string
		Self         struct{ DNSName string }
	}
	if json.Unmarshal(data, &status) != nil || status.BackendState != "Running" {
		return "", errors.New("invalid Tailscale status")
	}
	hostname := strings.TrimSuffix(status.Self.DNSName, ".")
	if !regexp.MustCompile(`^[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net$`).MatchString(hostname) {
		return "", errors.New("invalid Funnel hostname")
	}
	return hostname, nil
}

func funnelHasListeners(data []byte) (bool, error) {
	var config map[string]json.RawMessage
	if err := json.Unmarshal(data, &config); err != nil || config == nil {
		return false, errors.New("invalid Serve configuration")
	}
	for key, value := range config {
		if key == "AllowFunnel" || string(value) == "null" || string(value) == "false" {
			continue
		}
		var object map[string]json.RawMessage
		if json.Unmarshal(value, &object) != nil || len(object) > 0 {
			return true, nil
		}
	}
	return false, nil
}
func CheckFunnelVacant(data []byte) error {
	occupied, err := funnelHasListeners(data)
	if err != nil {
		return err
	}
	if occupied {
		return errors.New("existing Serve or Funnel configuration must be removed before starting")
	}
	return nil
}
func ownsFunnelPublication(data []byte, hostname string) (bool, error) {
	var config map[string]json.RawMessage
	if err := json.Unmarshal(data, &config); err != nil {
		return false, err
	}
	for key := range config {
		if key != "TCP" && key != "AllowFunnel" {
			return false, nil
		}
	}
	var tcp map[string]map[string]json.RawMessage
	if json.Unmarshal(config["TCP"], &tcp) != nil || len(tcp) != 1 || len(tcp["443"]) != 1 {
		return false, nil
	}
	var target string
	if json.Unmarshal(tcp["443"]["TCPForward"], &target) != nil || target != "127.0.0.1:8443" {
		return false, nil
	}
	var allowed map[string]bool
	if raw, ok := config["AllowFunnel"]; ok && json.Unmarshal(raw, &allowed) != nil {
		return false, nil
	}
	for key, value := range allowed {
		if key != hostname+":443" || !value {
			return false, nil
		}
	}
	return true, nil
}

type funnelChild struct {
	cmd  *exec.Cmd
	done chan struct{}
	err  error
}

func startFunnelChild(file string, args []string, env []string) (*funnelChild, error) {
	cmd := exec.Command(file, args...)
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, errors.New("funnel child failed to start")
	}
	child := &funnelChild{cmd: cmd, done: make(chan struct{})}
	go func() { child.err = cmd.Wait(); close(child.done) }()
	return child, nil
}
func (child *funnelChild) stop() {
	if child == nil {
		return
	}
	select {
	case <-child.done:
		return
	default:
	}
	_ = child.cmd.Process.Signal(syscall.SIGTERM)
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case <-child.done:
	case <-timer.C:
		_ = child.cmd.Process.Kill()
		<-child.done
	}
}

type funnelBuffer struct{ bytes.Buffer }

func (b *funnelBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 1024*1024 {
		return 0, errors.New("funnel command output limit exceeded")
	}
	return b.Buffer.Write(p)
}
func funnelCommand(ctx context.Context, cfg FunnelConfig, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, cfg.Tailscale, append([]string{"--socket=" + cfg.Socket}, args...)...)
	var output funnelBuffer
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		return nil, errors.New("funnel service command failed")
	}
	return output.Bytes(), nil
}

func ServeFunnel(ctx context.Context, cfg FunnelConfig) error {
	if err := cfg.validate(); err != nil {
		return err
	}
	for _, path := range []string{cfg.StateDirectory, cfg.EnvFile} {
		if err := deployPrivatePath(path, os.Getuid(), false); err != nil {
			return errors.New("private state directory and environment must be owned by the service user")
		}
	}
	var ownership struct{ Label, Target string }
	data, err := os.ReadFile(filepath.Join(cfg.StateDirectory, "launchd-owner.json"))
	if err != nil || json.Unmarshal(data, &ownership) != nil || ownership.Label != funnelLabel || ownership.Target != "127.0.0.1:8443" {
		return errors.New("dedicated Funnel state ownership marker does not match")
	}
	if info, err := os.Stat(cfg.Socket); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return errors.New("unexpected file at the Tailscale socket path")
		}
		if _, err = funnelCommand(ctx, cfg, "status", "--json"); err == nil {
			return errors.New("another tailscaled instance is active; stop it before starting launchd")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if ctx.Err() != nil {
		return nil
	}
	daemon, err := startFunnelChild(cfg.Tailscaled, []string{"--tun=userspace-networking", "--statedir=" + cfg.StateDirectory, "--state=" + filepath.Join(cfg.StateDirectory, "tailscaled.state"), "--socket=" + cfg.Socket, "--port=0"}, os.Environ())
	if err != nil {
		return err
	}
	defer daemon.stop()
	var status []byte
	for attempt := 0; attempt < 60; attempt++ {
		select {
		case <-ctx.Done():
			return nil
		case <-daemon.done:
			return errors.New("tailscaled stopped before becoming ready")
		default:
		}
		candidate, err := funnelCommand(ctx, cfg, "status", "--json")
		var state struct{ BackendState string }
		if err == nil && json.Unmarshal(candidate, &state) == nil && state.BackendState == "Running" {
			status = candidate
			break
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-daemon.done:
			timer.Stop()
			return errors.New("tailscaled stopped before becoming ready")
		case <-timer.C:
		}
	}
	if status == nil {
		return errors.New("tailscaled is not authenticated or ready; retrying under launchd")
	}
	hostname, err := FunnelHostname(status)
	if err != nil {
		return err
	}
	serve, err := funnelCommand(ctx, cfg, "serve", "status", "--json")
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
	occupied, err := funnelHasListeners(serve)
	if err != nil {
		return err
	}
	if occupied {
		owned, err := ownsFunnelPublication(serve, hostname)
		if err != nil || !owned {
			return errors.New("unrecognized Serve configuration; leaving it unchanged")
		}
		if _, err = funnelCommand(ctx, cfg, "funnel", "--tcp=443", "off"); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
	}
	if ctx.Err() != nil {
		return nil
	}
	env := deployEnvironment(os.Environ(), map[string]string{"HOME": cfg.Home, "PATH": filepath.Join(cfg.Directory, "bin") + ":/usr/bin:/bin:/usr/sbin:/sbin", "REPO_ROOT": cfg.Directory, "TS_SOCKET": cfg.Socket, "CADDY_CONFIG": filepath.Join(cfg.Directory, "Caddyfile"), "RUNTIME_HOST_ADMIN": filepath.Join(cfg.Directory, "runtime-host-admin")})
	funnel, err := startFunnelChild(cfg.Bash, []string{filepath.Join(cfg.Directory, "funnel.sh"), filepath.Join(cfg.Directory, "release"), cfg.EnvFile}, env)
	if err != nil {
		return err
	}
	defer funnel.stop()
	select {
	case <-ctx.Done():
		return nil
	case <-daemon.done:
		return errors.New("tailscaled stopped; restarting the complete Funnel service")
	case <-funnel.done:
		return errors.New("funnel stopped; restarting the complete Funnel service")
	}
}
