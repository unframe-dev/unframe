package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

type unityStatus struct {
	Phase                   string  `json:"phase"`
	ConnectionID            string  `json:"connectionId"`
	OriginVersion           string  `json:"originVersion"`
	StepID                  string  `json:"stepId"`
	Paused                  bool    `json:"paused"`
	ControlReady            bool    `json:"controlReady"`
	InputReady              bool    `json:"inputReady"`
	Completed               bool    `json:"completed"`
	ReliableSequence        string  `json:"reliableSequence"`
	StateSequence           string  `json:"stateSequence"`
	Connections             int     `json:"connections"`
	Assets                  int     `json:"assets"`
	TexturedRenderers       int     `json:"texturedRenderers"`
	Resynchronizations      int     `json:"resynchronizations"`
	CommandID               string  `json:"commandId"`
	CommandResult           string  `json:"commandResult"`
	SurfaceState            string  `json:"surfaceState"`
	Opacity                 float64 `json:"opacity"`
	RenderedOpacity         float64 `json:"renderedOpacity"`
	RenderedPixels          int     `json:"renderedPixels"`
	Error                   string  `json:"error"`
	FailureDetail           string  `json:"failureDetail"`
	ResynchronizationReason string  `json:"resynchronizationReason"`
}

func (f *fixture) startUnity(configPath string) {
	f.t.Helper()
	for _, path := range []string{f.env.UnityStatusFile, f.env.UnityCommandFile} {
		if !filepath.IsAbs(path) {
			f.t.Fatal("Unity E2E IPC paths must be absolute")
		}
	}
	log, err := os.OpenFile(filepath.Join(f.env.StateDirectory, "unity-launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		f.t.Fatal(err)
	}
	cmd := exec.CommandContext(f.ctx, "bash", filepath.Join(f.env.RepositoryRoot, "scripts/unity/test-native-editor.sh"), "realtime-e2e")
	cmd.Dir = f.env.RepositoryRoot
	for _, entry := range os.Environ() {
		key, value, _ := strings.Cut(entry, "=")
		// Product HTTP handlers receive the private CA explicitly; package-manager Git still needs system roots.
		if (key == "SSL_CERT_FILE" || key == "GIT_SSL_CAINFO") && value == f.env.CAFile {
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "UNFRAME_REALTIME_E2E_CONFIG="+configPath)
	cmd.Stdout, cmd.Stderr = log, log
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 10 * time.Second
	if err := cmd.Start(); err != nil {
		_ = log.Close()
		f.t.Fatal("start real Unity Editor:", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait(); close(done) }()
	f.owner.Cleanup(func() {
		select {
		case err := <-done:
			if err != nil && !f.owner.Failed() {
				f.owner.Errorf("Unity Editor E2E did not succeed; inspect its test XML and private launcher log: %v", err)
			}
		default:
			f.writeUnityCommand("stop")
			select {
			case err := <-done:
				if err != nil && !f.owner.Failed() {
					f.owner.Errorf("Unity Editor E2E did not shut down successfully: %v", err)
				}
			case <-time.After(20 * time.Second):
				_ = cmd.Process.Signal(os.Interrupt)
				select {
				case <-done: //nolint:errcheck // The shutdown timeout is reported below regardless of the exit error.
				case <-time.After(5 * time.Second):
					_ = cmd.Process.Kill()
					<-done //nolint:errcheck // The shutdown timeout is reported below regardless of the exit error.
				}
				if !f.owner.Failed() {
					f.owner.Error("Unity Editor did not exit after its stop command")
				}
			}
		}
		_ = log.Close()
	})
	f.t.Log("Waiting for the real Unity Editor, product Delivery/Realtime SDK, and renderer.")
	f.waitFor("real Unity Editor product attachment", 3*time.Minute, func() bool {
		select {
		case err := <-done:
			f.t.Fatalf("Unity Editor exited before product attachment: %v; inspect private launcher log", err)
		default:
		}
		status, ok := f.readUnityStatus()
		if ok && status.Completed {
			f.t.Fatalf("Unity product connection failed before readiness: %s", status.Error)
		}
		return ok && unityMatches(status, "start", false, 0)
	})
}

func (f *fixture) readUnityStatus() (unityStatus, bool) {
	data, err := os.ReadFile(f.env.UnityStatusFile)
	if err != nil {
		return unityStatus{}, false
	}
	var status unityStatus
	if json.Unmarshal(data, &status) != nil {
		return unityStatus{}, false
	}
	return status, true
}

func unityMatches(status unityStatus, step string, paused bool, previousConnections int) bool {
	wantState, wantOpacity := "reference-surface:default", 1.0
	if step == "finished" {
		wantState, wantOpacity = "reference-surface:inactive", 0.5
	}
	return status.Phase == "ready" && !status.Completed && status.ControlReady && status.InputReady && status.StepID == step && status.Paused == paused && status.Connections > previousConnections && status.Assets > 0 && status.TexturedRenderers > 0 && status.RenderedPixels > 100 && status.SurfaceState == wantState && status.Opacity == wantOpacity && status.RenderedOpacity == wantOpacity && (paused || status.StateSequence != "0")
}

func (f *fixture) waitUnity(label, step string, paused bool, previousConnections int) unityStatus {
	f.t.Helper()
	var status unityStatus
	f.wait(label, func() bool {
		var ok bool
		status, ok = f.readUnityStatus()
		if ok && status.Completed {
			f.t.Fatalf("%s: product Unity connection completed unexpectedly: %s/%s", label, status.Error, status.FailureDetail)
		}
		return ok && unityMatches(status, step, paused, previousConnections)
	})
	return status
}

func (f *fixture) writeUnityCommand(kind string) string {
	f.unityCommands++
	id := fmt.Sprintf("unity-%d-%s", f.unityCommands, kind)
	data, err := json.Marshal(map[string]string{"id": id, "kind": kind})
	if err != nil {
		f.owner.Error(err)
		return id
	}
	temporary := f.env.UnityCommandFile + ".go.tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		f.owner.Error(err)
		return id
	}
	if err := os.Rename(temporary, f.env.UnityCommandFile); err != nil {
		f.owner.Error(err)
	}
	return id
}

func (f *fixture) unityCommand(kind string) {
	f.t.Helper()
	id := f.writeUnityCommand(kind)
	f.wait("Unity product command "+kind, func() bool {
		status, ok := f.readUnityStatus()
		if !ok || status.CommandID != id {
			return false
		}
		if status.CommandResult != "accepted" {
			f.t.Fatalf("Unity product command %s did not succeed: %s/%s", kind, status.CommandResult, status.Error)
		}
		return true
	})
}

func (f *fixture) runUnityScenarios(t *testing.T) {
	viewer := f.connectViewer("")
	viewer.waitView("supplemental WS Viewer initial view", "start", false)
	f.waitBrowser("product Audience initial viewing", "start", false)
	f.assertCheckpoint("start", false)
	f.runTest(t, "product_pause_begin_and_late_join", func(t *testing.T) {
		f.unityCommand("pause")
		f.waitUnity("product Unity paused display", "start", true, 0)
		viewer.waitView("supplemental Viewer paused display", "start", true)
		f.waitBrowser("product Audience paused display", "start", true)
		f.rejoinBrowser("start", true)
		late := f.connectViewer("")
		late.waitView("late Viewer complete paused Snapshot", "start", true)
		late.close()
		f.unityCommand("begin")
		f.waitUnity("product Begin reaches accepted Running display", "start", false, 0)
		viewer.waitView("Viewer after product Begin", "start", false)
		f.waitBrowser("Audience after product Begin", "start", false)
		f.unityCommand("stale-gesture")
		f.waitUnity("product Unity rejects an input captured before pause", "start", false, 0)
		f.assertCheckpoint("start", false)
	})
	if t.Failed() {
		return
	}
	f.runTest(t, "product_recognized_gesture_and_rendered_effect", func(t *testing.T) {
		f.unityCommand("gesture")
		f.waitUnity("product Unity Gesture and renderer effect", "finished", false, 0)
		viewer.waitView("Viewer receives product Gesture effect", "finished", false)
		f.waitBrowser("product Audience renderer effect", "finished", false)
		f.unityCommand("retry-gesture")
		f.waitUnity("product Unity retains an idempotent command outcome", "finished", false, 0)
		f.assertCheckpoint("finished", true)
	})
	if t.Failed() {
		return
	}
	f.runTest(t, "product_runtime_restart_rejects_resume_and_recovers_fresh_snapshot", func(t *testing.T) {
		f.unityCommand("pause")
		before := f.waitUnity("product Unity durable pause", "finished", true, 0)
		f.waitBrowser("product Audience durable pause", "finished", true)
		browserBytes, err := os.ReadFile(f.env.BrowserStatusFile)
		if err != nil {
			t.Fatal(err)
		}
		browserBefore := decodeJSON[browserStatus](t, browserBytes)
		crashedPID := f.crashRuntime()
		viewer.waitClosed("Runtime crash closes the supplemental Viewer")
		viewer.close()
		f.waitRuntimeRestarted(crashedPID)
		recovered := f.waitUnity("real Unity SDK rejects its old Resume then applies a fresh paused Snapshot", "finished", true, before.Connections)
		if recovered.Resynchronizations <= before.Resynchronizations || recovered.ResynchronizationReason != "ReplayRangeUnavailable" {
			t.Fatal("real Unity did not observe a recoverable Resume rejection")
		}
		viewer = f.connectViewer(viewer.apiCredential)
		viewer.waitView("Viewer checkpoint recovery", "finished", true)
		f.waitBrowserAfter("product Audience checkpoint recovery", "finished", true, browserBefore.Connections)
		f.assertCheckpoint("finished", true)
		f.unityCommand("resume")
		f.waitUnity("product Unity recovered Running display", "finished", false, before.Connections)
		f.waitBrowser("product Audience recovered Running display", "finished", false)
	})
	if t.Failed() {
		return
	}
	f.runTest(t, "product_session_end_and_reentry_rejection", func(t *testing.T) {
		manifest, bootstrap := f.prepare(f.env.PresenterCredential, "quest-presentation-v2")
		prior, ok := f.readUnityStatus()
		if !ok {
			t.Fatal("Unity status absent before Session end")
		}
		origin, err := strconv.ParseUint(prior.OriginVersion, 10, 64)
		if err != nil {
			t.Fatal("Unity origin version is invalid")
		}
		sequence, err := strconv.ParseUint(prior.ReliableSequence, 10, 64)
		if err != nil {
			t.Fatal("Unity reliable cursor is invalid")
		}
		staleViewerToken := viewer.runtimeCredential
		f.request(http.MethodPost, "/sessions/"+f.env.SessionID+"/end", f.env.PresenterCredential, map[string]any{}, http.StatusOK)
		viewer.waitClosed("Session end closes Viewer Control")
		viewer.waitStateClosed("Session end closes Viewer State")
		f.wait("product Unity reaches an explicit terminal failure after Session end", func() bool {
			status, ok := f.readUnityStatus()
			return ok && !status.ControlReady && status.Completed && status.Error == "session-not-available"
		})
		f.waitBrowserEnded()
		f.waitAssignedChildStopped()
		f.prepareReplacementSession(manifest.Publication.PresentationId)
		f.assertRejectedStaleConnection(staleViewerToken, viewer.manifest.ProjectionProfile.RequiredRuntimeCapabilities)
		f.assertRejectedNativeConnection(bootstrap.Credential, manifest.ProjectionProfile.RequiredRuntimeCapabilities, nil)
		f.assertRejectedNativeConnection(bootstrap.Credential, manifest.ProjectionProfile.RequiredRuntimeCapabilities, &realtime.ResumeCursor{PriorConnectionId: prior.ConnectionID, AppliedReliableSequence: sequence, Fence: &presentation.RuntimeProjectionFence{SessionId: f.env.SessionID, Publication: manifest.Publication, AssignmentEpoch: manifest.ProjectionInstance.AssignmentEpoch, ProjectionProfileId: manifest.ProjectionProfile.ProjectionProfileId, PresentationOriginVersion: origin}})
		f.unityCommand("stop")
	})
}

func (f *fixture) rejoinBrowser(step string, paused bool) {
	f.t.Helper()
	if !filepath.IsAbs(f.env.BrowserCommandFile) {
		f.t.Fatal("browser UI IPC path must be absolute")
	}
	beforeData, err := os.ReadFile(f.env.BrowserStatusFile)
	if err != nil {
		f.t.Fatal(err)
	}
	before := decodeJSON[browserStatus](f.t, beforeData)
	id := fmt.Sprintf("browser-rejoin-%d", time.Now().UnixNano())
	data, err := json.Marshal(map[string]string{"id": id, "kind": "rejoin"})
	if err != nil {
		f.t.Fatal(err)
	}
	temporary := f.env.BrowserCommandFile + ".go.tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		f.t.Fatal(err)
	}
	if err := os.Rename(temporary, f.env.BrowserCommandFile); err != nil {
		f.t.Fatal(err)
	}
	f.waitFor("product Audience leaves and rejoins through its UI", 30*time.Second, func() bool {
		data, err := os.ReadFile(f.env.BrowserStatusFile)
		if err != nil {
			return false
		}
		var status browserStatus
		if json.Unmarshal(data, &status) != nil || status.CommandID != id {
			return false
		}
		if status.CommandResult == "failed" {
			f.t.Fatal("product Audience UI rejoin failed; inspect private browser log")
		}
		return status.CommandResult == "accepted"
	})
	f.waitBrowserAfter("product Audience late-join Snapshot and rendering", step, paused, before.Connections)
}
