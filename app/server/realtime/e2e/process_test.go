package e2e

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	grpc "google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	health "google.golang.org/grpc/health/grpc_health_v1"
)

func shellQuote(value string) string      { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }
func (f *fixture) runtimePIDPath() string { return filepath.Join(f.env.StateDirectory, "runtime.pid") }

func (f *fixture) startRuntimeHost() {
	f.t.Helper()
	f.startRuntimeHostProcess()
	f.prepareAssignedRuntime(f.env.SessionID)
}

func (f *fixture) startRuntimeHostProcess() {
	f.t.Helper()
	log, err := os.OpenFile(filepath.Join(f.env.StateDirectory, "realtime.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		f.t.Fatal(err)
	}
	wrapper := filepath.Join(f.env.StateDirectory, "assigned-runtime.sh")
	script := "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' \"$$\" > " + shellQuote(f.runtimePIDPath()) + "\nexec " + shellQuote(f.env.RuntimeBinary) + "\n"
	if err := os.WriteFile(wrapper, []byte(script), 0o700); err != nil {
		_ = log.Close()
		f.t.Fatal(err)
	}
	cmd := exec.CommandContext(f.ctx, f.env.HostBinary)
	values := map[string]string{}
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok {
			values[key] = value
		}
	}
	for key, value := range f.env.RuntimeEnv {
		values[key] = value
	}
	values["REALTIME_SERVER_EXECUTABLE"] = wrapper
	for key, value := range values {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	cmd.Stdout, cmd.Stderr = log, log
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 20 * time.Second
	if err := cmd.Start(); err != nil {
		_ = log.Close()
		f.t.Fatal("start Runtime Host:", err)
	}
	f.run, f.runLog = cmd, log
	f.runError = nil
	done := make(chan struct{})
	f.runDone = done
	go func() { f.runError = cmd.Wait(); close(done) }()
}

type runtimePreparation struct {
	State           string `json:"state"`
	RuntimeID       string `json:"runtimeId"`
	AssignmentEpoch uint64 `json:"assignmentEpoch"`
	LeaseExpiresAt  string `json:"leaseExpiresAt"`
}

func (f *fixture) prepareAssignedRuntime(sessionID string) {
	f.t.Helper()
	f.waitPreparedRuntime(sessionID, true)
}

func (f *fixture) waitPreparedRuntime(sessionID string, assign bool) {
	f.t.Helper()
	assigned := !assign
	f.waitFor("Runtime Host assignment and application readiness", 30*time.Second, func() bool {
		select {
		case <-f.runDone:
			f.t.Fatal("Runtime Host exited before preparation; inspect private Runtime log")
		default:
		}
		method := http.MethodGet
		var body any
		if !assigned {
			method = http.MethodPost
			body = map[string]any{}
		}
		data, status := f.requestRaw(method, "/sessions/"+sessionID+"/runtime-preparation", f.env.PresenterCredential, body)
		if status == http.StatusConflict {
			failure := decodeJSON[struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}](f.t, data)
			if !assigned && failure.Error.Code == "runtime_unavailable" {
				return false
			}
			f.t.Fatalf("Runtime preparation rejected with %d/%s", status, failure.Error.Code)
		}
		if status != http.StatusOK {
			f.t.Fatalf("Runtime preparation returned %d", status)
		}
		preparation := decodeJSON[runtimePreparation](f.t, data)
		if !assign && preparation.State == "unassigned" {
			return false
		}
		if preparation.State != "starting" && preparation.State != "ready" {
			f.t.Fatalf("Runtime preparation returned unexpected state %s", preparation.State)
		}
		if preparation.RuntimeID != f.env.RuntimeEnv["REALTIME_RUNTIME_ID"] || preparation.AssignmentEpoch == 0 {
			f.t.Fatal("Runtime preparation returned an invalid host assignment")
		}
		lease, err := time.Parse(time.RFC3339Nano, preparation.LeaseExpiresAt)
		if err != nil || !lease.After(time.Now()) {
			f.t.Fatal("Runtime preparation did not supply a live lease")
		}
		assigned = true
		if sessionID == f.env.SessionID {
			f.env.RuntimeEnv["REALTIME_ASSIGNMENT_EPOCH"] = strconv.FormatUint(preparation.AssignmentEpoch, 10)
		}
		return preparation.State == "ready" && f.runtimeServing()
	})
}

func (f *fixture) runtimeServing() bool {
	endpoint, _ := url.Parse(f.env.RuntimeEndpoint)
	connection, err := grpc.NewClient(endpoint.Host, grpc.WithTransportCredentials(credentials.NewTLS(f.tls.Clone())))
	if err != nil {
		f.t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	ctx, cancel := context.WithTimeout(f.ctx, 500*time.Millisecond)
	defer cancel()
	response, err := health.NewHealthClient(connection).Check(ctx, &health.HealthCheckRequest{})
	return err == nil && response.Status == health.HealthCheckResponse_SERVING
}

func (f *fixture) runtimePID() int {
	f.t.Helper()
	data, err := os.ReadFile(f.runtimePIDPath())
	if err != nil {
		f.t.Fatal("read assigned Runtime PID:", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 1 {
		f.t.Fatal("assigned Runtime PID is invalid")
	}
	return pid
}

func (f *fixture) crashRuntime() int {
	f.t.Helper()
	pid := f.runtimePID()
	process, err := os.FindProcess(pid)
	if err != nil {
		f.t.Fatal(err)
	}
	if err := process.Kill(); err != nil {
		f.t.Fatal("crash assigned Runtime child:", err)
	}
	return pid
}

func (f *fixture) waitRuntimeRestarted(previousPID int) {
	f.t.Helper()
	f.waitFor("Runtime Host automatically restarts its assigned child", 30*time.Second, func() bool {
		data, err := os.ReadFile(f.runtimePIDPath())
		if err != nil {
			return false
		}
		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		return err == nil && pid > 1 && pid != previousPID && f.runtimeServing()
	})
	f.prepareAssignedRuntime(f.env.SessionID)
}

func (f *fixture) waitAssignedChildStopped() {
	f.t.Helper()
	pid := f.runtimePID()
	f.waitFor("Session end stops the assigned Runtime child", 30*time.Second, func() bool {
		select {
		case <-f.runDone:
			f.t.Fatal("Runtime Host stopped instead of releasing its child")
		default:
		}
		data := f.request(http.MethodGet, "/sessions/"+f.env.SessionID+"/runtime-preparation", f.env.PresenterCredential, nil, http.StatusOK)
		status := decodeJSON[runtimePreparation](f.t, data)
		return status.State == "ended" && errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
	})
}

func (f *fixture) prepareReplacementSession(presentationID string) {
	f.t.Helper()
	created := decodeJSON[struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}](f.t, f.request(http.MethodPost, "/sessions", f.env.PresenterCredential, map[string]any{"presentationId": presentationID}, http.StatusCreated))
	if created.Session.ID == "" || created.Session.ID == f.env.SessionID {
		f.t.Fatal("replacement Session identity is invalid")
	}
	f.prepareAssignedRuntime(created.Session.ID)
}

func (f *fixture) stopRuntimeHost() {
	if f.run == nil {
		return
	}
	cmd := f.run
	f.run = nil
	exited := false
	select {
	case <-f.runDone:
		exited = true
	default:
	}
	if !exited {
		_ = cmd.Process.Signal(os.Interrupt)
		select {
		case <-f.runDone:
		case <-time.After(20 * time.Second):
			_ = cmd.Process.Kill()
			<-f.runDone
			f.t.Error("Runtime Host exceeded its graceful shutdown budget")
		}
	}
	if exited && f.ctx.Err() == nil {
		f.t.Errorf("Runtime Host exited unexpectedly: %v", f.runError)
	}
	if !exited && f.runError != nil && f.ctx.Err() == nil {
		f.t.Errorf("Runtime Host did not shut down cleanly: %v", f.runError)
	}
	_ = f.runLog.Close()
	f.runLog = nil
	data, err := os.ReadFile(filepath.Join(f.env.StateDirectory, "realtime.log"))
	if err != nil {
		f.t.Error("read Runtime race evidence:", err)
		return
	}
	if strings.Contains(string(data), "WARNING: DATA RACE") {
		f.t.Error("Runtime or Host race detector reported a data race; inspect private Runtime log")
	}
}

// Expire only the isolated local D1 assignment; no production resource is used.
func (f *fixture) expireLocalAssignment() {
	f.t.Helper()
	query := "UPDATE runtime_assignments SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = '" + strings.ReplaceAll(f.env.SessionID, "'", "''") + "'"
	cmd := exec.CommandContext(f.ctx, "pnpm", "--filter", "@unframe/control-plane", "exec", "wrangler", "d1", "execute", "unframe-realtime-e2e", "--local", "--persist-to", filepath.Join(f.env.StateDirectory, "persist"), "--config", filepath.Join(f.env.StateDirectory, "wrangler.toml"), "--command", query)
	cmd.Dir = f.env.RepositoryRoot
	if _, err := cmd.CombinedOutput(); err != nil {
		f.t.Fatal("expire isolated local Runtime assignment:", err)
	}
}
