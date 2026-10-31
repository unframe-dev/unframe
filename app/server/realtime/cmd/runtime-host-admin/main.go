// Command runtime-host-admin controls one local Funnel deployment without SSH.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/host"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

type deploymentConfig struct {
	EnvFile   string `json:"envFile"`
	Socket    string `json:"socket"`
	Tailscale string `json:"tailscale"`
	Bash      string `json:"bash"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string) error {
	flags := flag.NewFlagSet("runtime-host-admin", flag.ContinueOnError)
	deployment := flags.String("deployment", "", "absolute Funnel deployment directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if !filepath.IsAbs(*deployment) {
		return errors.New("--deployment must be an absolute path")
	}
	command := strings.Join(flags.Args(), " ")
	directory := filepath.Join(*deployment, "update-control")
	switch command {
	case "activity release":
		return host.SetUpdateDrain(directory, false)
	case "activity prepare":
		requestedAt := time.Now()
		if err := host.SetUpdateDrain(directory, true); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		var result host.UpdateStatus
		err := retry(ctx, func(ctx context.Context) error {
			status, err := host.ReadUpdateStatus(directory, time.Now())
			if err != nil {
				return err
			}
			if !status.Draining || status.UpdatedAt.Before(requestedAt) {
				return errors.New("host has not acknowledged drain")
			}
			if err = verifyStatusPID(*deployment, status.PID); err != nil {
				return err
			}
			result = status
			return nil
		})
		if err != nil {
			return errors.New("host did not acknowledge drain within 20 seconds; drain remains set")
		}
		return json.NewEncoder(os.Stdout).Encode(struct {
			ActiveSessions int `json:"activeSessions"`
		}{result.ActiveSessions})
	case "restart":
		pid, err := deploymentPID(*deployment)
		if err != nil {
			return err
		}
		if err = syscall.Kill(pid, syscall.SIGTERM); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return retry(ctx, func(context.Context) error {
			if err := syscall.Kill(pid, 0); errors.Is(err, syscall.ESRCH) {
				return nil
			}
			return errors.New("previous runtime host has not exited")
		})
	case "health", "rollback-health":
		config, err := loadDeployment(*deployment)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		if err = retry(ctx, func(ctx context.Context) error {
			pid, err := deploymentPID(*deployment)
			if err != nil {
				return err
			}
			if err = validateHealthStatus(directory, pid, command == "rollback-health"); err != nil {
				return err
			}
			return deploymentHealth(ctx, config)
		}); err != nil {
			return errors.New("runtime host health did not recover within 90 seconds")
		}
		fmt.Println("Runtime Host health: SERVING")
		return nil
	default:
		return errors.New("usage: runtime-host-admin --deployment /absolute/Funnel {activity prepare|activity release|restart|health|rollback-health}")
	}
}
func loadDeployment(directory string) (deploymentConfig, error) {
	var config deploymentConfig
	data, err := os.ReadFile(filepath.Join(directory, "config.json"))
	if err != nil {
		return config, err
	}
	if err = json.Unmarshal(data, &config); err != nil {
		return config, err
	}
	for _, path := range []string{config.EnvFile, config.Socket, config.Tailscale, config.Bash} {
		if !filepath.IsAbs(path) {
			return config, errors.New("deployment config paths must be absolute")
		}
	}
	return config, nil
}
func findDeploymentPID(output string, uid int, executable string) (int, error) {
	pid := 0
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		candidate, err := strconv.Atoi(fields[0])
		if err != nil || candidate <= 0 {
			continue
		}
		owner, err := strconv.Atoi(fields[1])
		if err != nil || owner != uid {
			continue
		}
		// comm includes spaces in executable paths; preserve them after the UID field.
		rest := strings.TrimSpace(line)
		rest = strings.TrimSpace(rest[len(fields[0]):])
		rest = strings.TrimSpace(rest[len(fields[1]):])
		if rest != executable {
			continue
		}
		if pid != 0 {
			return 0, errors.New("multiple runtime hosts match this deployment")
		}
		pid = candidate
	}
	if pid == 0 {
		return 0, errors.New("no owned runtime host matches this deployment")
	}
	return pid, nil
}
func deploymentPID(directory string) (int, error) {
	data, err := exec.Command("/bin/ps", "-axo", "pid=,uid=,comm=").Output()
	if err != nil {
		return 0, errors.New("cannot inspect runtime host processes")
	}
	return findDeploymentPID(string(data), os.Getuid(), filepath.Join(directory, "release", "runtime-host"))
}
func verifyStatusPID(directory string, pid int) error {
	actual, err := deploymentPID(directory)
	if err != nil {
		return err
	}
	if actual != pid {
		return errors.New("status does not belong to this deployment host")
	}
	return nil
}
func retry(ctx context.Context, check func(context.Context) error) error {
	for {
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := check(attempt)
		cancel()
		if err == nil {
			return nil
		}
		timer := time.NewTimer(500 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
func deploymentHealth(ctx context.Context, config deploymentConfig) error {
	output, err := exec.CommandContext(ctx, config.Tailscale, "--socket="+config.Socket, "status", "--json").Output()
	if err != nil {
		return errors.New("tailscale status unavailable")
	}
	var status struct{ Self struct{ DNSName string } }
	if err = json.Unmarshal(output, &status); err != nil {
		return errors.New("tailscale status invalid")
	}
	hostname := strings.TrimSuffix(status.Self.DNSName, ".")
	if hostname == "" || strings.ContainsAny(hostname, "/: \r\n\t") {
		return errors.New("tailscale DNS name unavailable")
	}
	origins, err := exec.CommandContext(ctx, config.Bash, "-c", `set -e; source "$1" >/dev/null 2>&1; printf '%s' "${REALTIME_BROWSER_ORIGINS-}"`, "runtime-host-admin", config.EnvFile).Output()
	if err != nil {
		return errors.New("cannot load browser origins")
	}
	origin := ""
	for _, value := range strings.Split(string(origins), ",") {
		if value = strings.TrimSpace(value); value != "" {
			origin = value
			break
		}
	}
	if origin == "" {
		return errors.New("no browser origin is configured")
	}
	if err = grpcHealth(ctx, "127.0.0.1:9090", insecure.NewCredentials()); err != nil {
		return err
	}
	if err = grpcHealth(ctx, hostname+":443", credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: hostname})); err != nil {
		return err
	}
	return browserHealth(ctx, "wss://"+hostname, origin)
}
func grpcHealth(ctx context.Context, target string, transport credentials.TransportCredentials) error {
	connection, err := grpc.NewClient(target, grpc.WithTransportCredentials(transport))
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close() }()
	response, err := healthpb.NewHealthClient(connection).Check(ctx, &healthpb.HealthCheckRequest{})
	if err != nil {
		return err
	}
	if response.Status != healthpb.HealthCheckResponse_SERVING {
		return errors.New("gRPC health is not SERVING")
	}
	return nil
}
func browserHealth(ctx context.Context, endpoint, origin string) error {
	for _, path := range []string{"/browser/control", "/browser/state"} {
		conn, response, err := websocket.Dial(ctx, endpoint+path, &websocket.DialOptions{Subprotocols: []string{"unframe.realtime.v3"}, HTTPHeader: http.Header{"Origin": []string{origin}}})
		if err != nil {
			if response != nil && response.Body != nil {
				_ = response.Body.Close()
			}
			return err
		}
		protocol := conn.Subprotocol()
		_ = conn.CloseNow()
		if protocol != "unframe.realtime.v3" {
			return errors.New("browser protocol negotiation failed")
		}
	}
	return nil
}

func validateHealthStatus(directory string, pid int, rollback bool) error {
	if rollback {
		return nil
	}
	status, err := host.ReadUpdateStatus(directory, time.Now())
	if err != nil {
		return err
	}
	if status.PID != pid {
		return errors.New("status does not belong to this deployment host")
	}
	return nil
}
