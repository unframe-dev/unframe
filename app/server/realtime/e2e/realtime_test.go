package e2e

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type environment struct {
	ControlPlaneOrigin          string            `json:"controlPlaneOrigin"`
	RuntimeEndpoint             string            `json:"runtimeEndpoint"`
	AudienceOrigin              string            `json:"audienceOrigin"`
	AudienceCapabilityProfileID string            `json:"audienceCapabilityProfileId"`
	SessionID                   string            `json:"sessionId"`
	JoinCode                    string            `json:"joinCode"`
	PresenterCredential         string            `json:"presenterCredential"`
	CAFile                      string            `json:"caFile"`
	RuntimeBinary               string            `json:"runtimeBinary"`
	HostBinary                  string            `json:"hostBinary"`
	RuntimeEnv                  map[string]string `json:"runtimeEnv"`
	StateDirectory              string            `json:"stateDirectory"`
	RepositoryRoot              string            `json:"repositoryRoot"`
	BrowserStatusFile           string            `json:"browserStatusFile"`
	UnityEnabled                bool              `json:"unityEnabled"`
	UnityStatusFile             string            `json:"unityStatusFile"`
	UnityCommandFile            string            `json:"unityCommandFile"`
	BrowserCommandFile          string            `json:"browserCommandFile"`
}

type fixture struct {
	t             *testing.T
	owner         *testing.T
	env           environment
	ctx           context.Context
	client        *http.Client
	tls           *tls.Config
	run           *exec.Cmd
	runLog        *os.File
	runDone       chan struct{}
	runError      error
	unityCommands int
}

func TestRealtimeSynchronizationAndRecovery(t *testing.T) {
	configPath := os.Getenv("UNFRAME_REALTIME_E2E_CONFIG")
	if configPath == "" {
		t.Skip("Use nix run .#realtime-e2e to start isolated real services.")
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal("read E2E environment configuration:", err)
	}
	var env environment
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal("decode E2E environment configuration:", err)
	}
	for _, origin := range []string{env.ControlPlaneOrigin, env.RuntimeEndpoint, env.AudienceOrigin} {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "localhost" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			t.Fatal("E2E service origins must be HTTPS localhost origins")
		}
	}
	if env.SessionID == "" || env.JoinCode == "" || env.PresenterCredential == "" || env.AudienceCapabilityProfileID == "" || len(env.RuntimeEnv) == 0 {
		t.Fatal("E2E environment is missing a session, credential, capability, or Runtime environment")
	}
	for _, path := range []string{env.CAFile, env.RuntimeBinary, env.HostBinary, env.StateDirectory, env.RepositoryRoot, env.BrowserStatusFile} {
		if !filepath.IsAbs(path) {
			t.Fatal("E2E environment paths must be absolute")
		}
	}
	ca, err := os.ReadFile(env.CAFile)
	if err != nil {
		t.Fatal(err)
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		t.Fatal(err)
	}
	if !roots.AppendCertsFromPEM(ca) {
		t.Fatal("E2E CA file contains no certificates")
	}
	duration := 150 * time.Second
	if env.UnityEnabled {
		duration = 9 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	t.Cleanup(cancel)
	f := &fixture{t: t, owner: t, env: env, ctx: ctx, tls: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}
	f.client = &http.Client{Transport: &http.Transport{TLSClientConfig: f.tls}, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	t.Cleanup(f.client.CloseIdleConnections)
	if !env.UnityEnabled {
		f.request(http.MethodPost, "/sessions/"+env.SessionID+"/start", env.PresenterCredential, map[string]any{}, http.StatusOK)
	}
	t.Cleanup(f.stopRuntimeHost)
	f.startRuntimeHost()
	f.startBrowser(configPath)
	if env.UnityEnabled {
		f.startUnity(configPath)
		f.runUnityScenarios(t)
		return
	}

	presenter := f.connectNative(nil)
	viewer := f.connectViewer("")
	viewer2 := f.connectViewer("")
	presenter.wait("Presenter input synchronization", func(s peerState) bool {
		return s.synchronization.GetPhase() == realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
	})
	for _, peer := range []*peer{presenter, viewer, viewer2} {
		peer.waitView("initial shared Step", "start", false)
	}
	f.waitBrowser("initial browser attachment", "start", false)
	f.assertCheckpoint("start", false)

	f.runTest(t, "pause_resume_and_late_join", func(t *testing.T) {
		before := presenter.snapshot()
		presenter.control(realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE, "pause-initial")
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("pause replicated", "start", true)
		}
		f.waitBrowser("browser pause", "start", true)
		f.rejoinBrowser("start", true)
		late := f.connectViewer("")
		late.waitView("late Viewer paused Snapshot", "start", true)
		assertSameSharedView(t, presenter, viewer, viewer2, late)
		late.close()
		resumeCut := presenter.control(realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME, "resume-initial")
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("resume replicated", "start", false)
			peer.wait("State delivery after resume", func(s peerState) bool { return s.stateSequence > 0 && s.stateBaseSequence >= resumeCut })
		}
		f.waitBrowser("browser resume", "start", false)
		presenter.wait("input synchronized after resume", func(s peerState) bool {
			return s.synchronization.GetPhase() == realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
		})
		stale := &realtime.GestureInputCommand{ClientEventId: eventID(before.synchronization.CommandEpoch, "stale-before-pause"), CommandEpoch: before.synchronization.CommandEpoch, InputContext: before.synchronization.InputContext, PresentationOriginVersion: before.fence.PresentationOriginVersion, Gesture: presentation.GestureKind_GESTURE_KIND_SWIPE_LEFT}
		presenter.send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_GestureInput{GestureInput: stale}})
		if reason := presenter.outcome(stale.ClientEventId).GetRejected().GetReason(); reason != realtime.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_CONTEXT_STALE {
			t.Fatalf("input captured before pause was not rejected as stale: %v", reason)
		}
	})
	if t.Failed() {
		return
	}

	f.runTest(t, "recognized_input_and_idempotent_retry", func(t *testing.T) {
		command := presenter.gesture("advance-step")
		outcome := presenter.outcome(command.ClientEventId)
		if outcome.GetAccepted().GetCueCommitted().GetCueId() != "swipe-continue" {
			t.Fatalf("recognized gesture did not commit the expected Cue: %v", outcome)
		}
		presenter.send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_GestureInput{GestureInput: command}})
		replayed := presenter.retriedOutcome(command.ClientEventId)
		if !proto.Equal(outcome, replayed) {
			t.Fatalf("same command retry returned a different outcome")
		}
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("Step transition replicated", "finished", false)
		}
		f.waitBrowser("browser Step transition", "finished", false)
		f.assertCheckpoint("finished", true)
	})
	if t.Failed() {
		return
	}

	f.runTest(t, "native_resume_and_browser_snapshot_reconnection", func(t *testing.T) {
		before := presenter.snapshot()
		presenter.disconnect()
		presenter = f.connectNative(&before)
		presenter.wait("native reconnect catches up", func(s peerState) bool {
			return s.synchronization.GetPhase() == realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
		})
		if presenter.snapshot().connectionID == before.connectionID {
			t.Fatal("native reconnect reused a connection identity")
		}
		credential := viewer.apiCredential
		old := viewer.snapshot()
		viewer.disconnect()
		viewer = f.connectViewer(credential)
		viewer.waitView("WS reconnect Snapshot", "finished", true)
		if viewer.snapshot().connectionID == old.connectionID || viewer.snapshot().sequence < old.sequence {
			t.Fatal("WS reconnect did not receive a fresh caught-up Snapshot")
		}
		resumeCut := presenter.control(realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME, "resume-reconnected")
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("reconnected peers converge", "finished", false)
			peer.wait("reconnected State delivery after resume", func(s peerState) bool { return s.stateSequence > 0 && s.stateBaseSequence >= resumeCut })
		}
		f.waitBrowser("browser after native reconnect", "finished", false)
	})
	if t.Failed() {
		return
	}

	f.runTest(t, "process_restart_restores_control_plane_checkpoint", func(t *testing.T) {
		presenter.control(realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE, "pause-before-restart")
		presenter.waitView("durable pause", "finished", true)
		viewer.waitView("durable Viewer state", "finished", true)
		f.waitBrowser("browser durable pause", "finished", true)
		browserBefore, err := os.ReadFile(f.env.BrowserStatusFile)
		if err != nil {
			t.Fatal("read browser checkpoint evidence:", err)
		}
		connectionsBefore := decodeJSON[browserStatus](t, browserBefore).Connections
		before := viewer.snapshot()
		crashedPID := f.crashRuntime()
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitClosed("Runtime process stopped")
			peer.close()
		}
		f.waitRuntimeRestarted(crashedPID)
		presenter = f.connectNative(nil)
		viewer = f.connectViewer(viewer.apiCredential)
		viewer2 = f.connectViewer(viewer2.apiCredential)
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("checkpoint restored paused", "finished", true)
			if peer.snapshot().sequence < before.sequence {
				t.Fatal("recovery rolled the reliable sequence backwards")
			}
		}
		assertSameSharedView(t, presenter, viewer, viewer2)
		f.waitBrowserAfter("browser checkpoint recovery", "finished", true, connectionsBefore)
		f.assertCheckpoint("finished", true)
		resumeCut := presenter.control(realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME, "resume-recovered")
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("recovered peers resume", "finished", false)
			peer.wait("recovered State delivery after resume", func(s peerState) bool { return s.stateSequence > 0 && s.stateBaseSequence >= resumeCut })
		}
		f.waitBrowser("browser recovered resume", "finished", false)
	})
	if t.Failed() {
		return
	}

	f.runTest(t, "expired_lease_restores_same_session_in_new_assignment", func(t *testing.T) {
		presenter.control(realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE, "pause-before-lease-expiry")
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("pause before host shutdown", "finished", true)
		}
		before := presenter.snapshot()
		oldPresenterToken := presenter.runtimeCredential
		oldViewerToken := viewer.runtimeCredential
		oldManifest := presenter.manifest
		oldEpoch := f.env.RuntimeEnv["REALTIME_ASSIGNMENT_EPOCH"]
		f.assertCheckpoint("finished", true)
		f.stopRuntimeHost()
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitClosed("host shutdown closes the previous assignment")
			peer.close()
		}
		f.expireLocalAssignment()
		f.startRuntimeHostProcess()
		f.waitPreparedRuntime(f.env.SessionID, false)
		if f.env.RuntimeEnv["REALTIME_ASSIGNMENT_EPOCH"] == oldEpoch {
			t.Fatal("expired lease reused the old assignment epoch")
		}
		presenter = f.connectNative(nil)
		viewer = f.connectViewer(viewer.apiCredential)
		viewer2 = f.connectViewer(viewer2.apiCredential)
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("same Session restored in a new assignment", "finished", true)
			if peer.snapshot().sequence < before.sequence {
				t.Fatal("new assignment rolled the reliable sequence backwards")
			}
		}
		assertSameSharedView(t, presenter, viewer, viewer2)
		f.assertCheckpoint("finished", true)
		f.assertRejectedStaleConnection(oldViewerToken, viewer.manifest.ProjectionProfile.RequiredRuntimeCapabilities)
		f.assertRejectedNativeConnection(oldPresenterToken, oldManifest.ProjectionProfile.RequiredRuntimeCapabilities, nil)
		f.assertRejectedNativeConnection(oldPresenterToken, oldManifest.ProjectionProfile.RequiredRuntimeCapabilities, &realtime.ResumeCursor{PriorConnectionId: before.connectionID, AppliedReliableSequence: before.sequence, Fence: before.fence})
		presenter.control(realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME, "resume-after-lease-expiry")
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitView("restored assignment resumes explicitly", "finished", false)
		}
		f.waitBrowser("browser follows new assignment", "finished", false)
	})
	if t.Failed() {
		return
	}

	f.runTest(t, "session_end_closes_streams_and_rejects_reentry", func(t *testing.T) {
		staleToken := viewer.runtimeCredential
		stalePresenterToken := presenter.runtimeCredential
		prior := presenter.snapshot()
		f.request(http.MethodPost, "/sessions/"+env.SessionID+"/end", env.PresenterCredential, map[string]any{}, http.StatusOK)
		for _, peer := range []*peer{presenter, viewer, viewer2} {
			peer.waitClosed("Session end invalidates existing Control")
			peer.waitStateClosed("Session end invalidates existing State")
		}
		f.request(http.MethodPost, "/sessions/"+env.SessionID+"/bootstrap", env.PresenterCredential, map[string]any{}, http.StatusConflict)
		f.request(http.MethodPost, "/viewer-credentials", "", map[string]any{"joinCode": env.JoinCode}, http.StatusNotFound)
		f.waitAssignedChildStopped()
		f.prepareReplacementSession(presenter.manifest.Publication.PresentationId)
		f.assertRejectedStaleConnection(staleToken, viewer.manifest.ProjectionProfile.RequiredRuntimeCapabilities)
		f.assertRejectedNativeConnection(stalePresenterToken, presenter.manifest.ProjectionProfile.RequiredRuntimeCapabilities, nil)
		f.assertRejectedNativeConnection(stalePresenterToken, presenter.manifest.ProjectionProfile.RequiredRuntimeCapabilities, &realtime.ResumeCursor{PriorConnectionId: prior.connectionID, AppliedReliableSequence: prior.sequence, Fence: prior.fence})
		f.waitBrowserEnded()
	})
}

func (f *fixture) request(method, path, bearer string, value any, status int) []byte {
	data, received := f.requestRaw(method, path, bearer, value)
	if received != status {
		f.t.Fatalf("API %s %s returned %d, want %d", method, path, received, status)
	}
	return data
}

func (f *fixture) requestRaw(method, path, bearer string, value any) ([]byte, int) {
	f.t.Helper()
	var body io.Reader
	if value != nil {
		encoded, err := json.Marshal(value)
		if err != nil {
			f.t.Fatal(err)
		}
		body = strings.NewReader(string(encoded))
	}
	req, err := http.NewRequestWithContext(f.ctx, method, f.env.ControlPlaneOrigin+path, body)
	if err != nil {
		f.t.Fatal(err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	req.Header.Set("Origin", f.env.AudienceOrigin)
	if value != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := f.client.Do(req)
	if err != nil {
		f.t.Fatalf("API %s %s failed (credentials omitted): %T", method, path, err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		f.t.Fatal("read API response:", err)
	}
	if response.Header.Get("Access-Control-Allow-Origin") != f.env.AudienceOrigin {
		f.t.Fatalf("API %s CORS origin mismatch", path)
	}
	return data, response.StatusCode
}

func decodeJSON[T any](t *testing.T, data []byte) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal("decode API response:", err)
	}
	return value
}

func eventID(epoch uint64, label string) string {
	digest := sha256.Sum256([]byte(label))
	digest[6] = digest[6]&0x0f | 0x40
	digest[8] = digest[8]&0x3f | 0x80
	return fmt.Sprintf("%d:%x-%x-%x-%x-%x", epoch, digest[0:4], digest[4:6], digest[6:8], digest[8:10], digest[10:16])
}

type browserStatus struct {
	Phase             string  `json:"phase"`
	StepID            string  `json:"stepId"`
	Paused            bool    `json:"paused"`
	ReliableSequence  string  `json:"reliableSequence"`
	StateSequence     string  `json:"stateSequence"`
	Connections       int     `json:"connections"`
	Assets            int     `json:"assets"`
	Error             string  `json:"error"`
	Continued         *bool   `json:"continued"`
	SurfaceState      string  `json:"surfaceState"`
	Opacity           float64 `json:"opacity"`
	DrawCalls         int     `json:"drawCalls"`
	TexturedRenderers int     `json:"texturedRenderers"`
	RenderedOpacity   float64 `json:"renderedOpacity"`
	RenderedPixels    int     `json:"renderedPixels"`
	CommandID         string  `json:"commandId"`
	CommandResult     string  `json:"commandResult"`
}

func (f *fixture) startBrowser(configPath string) {
	f.t.Helper()
	log, err := os.OpenFile(filepath.Join(f.env.StateDirectory, "browser.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		f.t.Fatal(err)
	}
	cmd := exec.CommandContext(f.ctx, "node", "--import", "tsx", filepath.Join(f.env.RepositoryRoot, "scripts/realtime-e2e/browser-viewer.mts"), configPath)
	cmd.Dir = filepath.Join(f.env.RepositoryRoot, "packages/contracts")
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 5 * time.Second
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		_ = log.Close()
		f.t.Fatal("start browser companion:", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait(); close(done) }()
	f.owner.Cleanup(func() {
		var result error
		select {
		case result = <-done:
			if f.ctx.Err() == nil && !f.owner.Failed() {
				f.owner.Error("product Audience companion exited before test cleanup")
			}
		default:
			_ = cmd.Process.Signal(os.Interrupt)
			select {
			case result = <-done:
			case <-time.After(5 * time.Second):
				_ = cmd.Process.Kill()
				result = <-done
				f.owner.Error("product Audience companion exceeded its graceful shutdown budget")
			}
		}
		if result != nil {
			f.owner.Errorf("product Audience companion failed: %v; inspect private browser log", result)
		}
		_ = log.Close()
	})
}

func (f *fixture) waitBrowser(label, step string, paused bool) {
	f.waitBrowserAfter(label, step, paused, 0)
}

func (f *fixture) waitBrowserAfter(label, step string, paused bool, previousConnections int) {
	f.t.Helper()
	f.wait(label, func() bool {
		data, err := os.ReadFile(f.env.BrowserStatusFile)
		if err != nil {
			return false
		}
		var state browserStatus
		if json.Unmarshal(data, &state) != nil {
			return false
		}
		if state.Phase == "error" {
			f.t.Fatal("browser companion failed; inspect private browser log")
		}
		wantState, wantOpacity := "reference-surface:default", 1.0
		if step == "finished" {
			wantState, wantOpacity = "reference-surface:inactive", 0.5
		}
		return state.Phase == "ready" && state.StepID == step && state.Paused == paused && state.Assets > 0 && state.Connections > previousConnections && state.Continued == nil && state.SurfaceState == wantState && state.Opacity == wantOpacity && state.DrawCalls > 0 && state.TexturedRenderers > 0 && state.RenderedOpacity == wantOpacity && state.RenderedPixels > 0
	})
}

func (f *fixture) waitBrowserEnded() {
	f.t.Helper()
	f.wait("browser Session end", func() bool {
		data, err := os.ReadFile(f.env.BrowserStatusFile)
		if err != nil {
			return false
		}
		var state browserStatus
		if json.Unmarshal(data, &state) != nil {
			return false
		}
		if state.Phase == "ended" {
			return true
		}
		return false
	})
}

func (f *fixture) wait(label string, ready func() bool) {
	f.waitFor(label, 15*time.Second, ready)
}

func (f *fixture) waitFor(label string, timeout time.Duration, ready func() bool) {
	f.t.Helper()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		if ready() {
			return
		}
		select {
		case <-f.ctx.Done():
			f.t.Fatalf("%s: E2E deadline exceeded", label)
		case <-timer.C:
			f.t.Fatalf("%s: timed out", label)
		case <-ticker.C:
		}
	}
}

func sharedView(peer *peer) *realtime.ParticipantRuntimeView {
	view := peer.snapshot().view
	if view == nil {
		return nil
	}
	view.ProjectionProfileId = ""
	view.BaseReliableSequence = 0
	view.EnabledLogicalInputs = nil
	return view
}

func assertSameSharedView(t *testing.T, peers ...*peer) {
	t.Helper()
	want := sharedView(peers[0])
	for _, peer := range peers[1:] {
		got := sharedView(peer)
		// Private capability catalogs and profile identities differ by role; the sample's scene is public.
		if !proto.Equal(want, got) {
			t.Fatalf("paused shared scene differs between native Presenter and WS Viewer")
		}
	}
}

func (f *fixture) runTest(parent *testing.T, name string, run func(*testing.T)) {
	parent.Run(name, func(t *testing.T) {
		f.t = t
		defer func() { f.t = parent }()
		run(t)
	})
}

func (f *fixture) assertCheckpoint(step string, continued bool) {
	f.t.Helper()
	query := url.Values{"sessionId": {f.env.SessionID}, "runtimeId": {f.env.RuntimeEnv["REALTIME_RUNTIME_ID"]}, "assignmentEpoch": {f.env.RuntimeEnv["REALTIME_ASSIGNMENT_EPOCH"]}}
	response := decodeJSON[struct {
		Checkpoint json.RawMessage `json:"checkpoint"`
	}](f.t, f.request(http.MethodGet, "/internal/runtime/bootstrap?"+query.Encode(), f.env.RuntimeEnv["REALTIME_SERVICE_IDENTITY"], nil, http.StatusOK))
	checkpoint := new(realtime.DurableCheckpointEnvelope)
	if err := protojson.Unmarshal(response.Checkpoint, checkpoint); err != nil {
		f.t.Fatal("Control Plane did not return a durable checkpoint:", err)
	}
	if checkpoint.SessionId != f.env.SessionID || checkpoint.RuntimeId != f.env.RuntimeEnv["REALTIME_RUNTIME_ID"] || checkpoint.CanonicalSnapshotHash != fmt.Sprintf("sha256:%x", sha256.Sum256(checkpoint.CanonicalSnapshotPayload)) {
		f.t.Fatal("Control Plane checkpoint identity/hash mismatch")
	}
	snapshot := new(realtime.CanonicalRuntimeSnapshot)
	if err := proto.Unmarshal(checkpoint.CanonicalSnapshotPayload, snapshot); err != nil {
		f.t.Fatal("decode Control Plane canonical checkpoint:", err)
	}
	if snapshot.Progression.GetCurrentStepId() != step {
		f.t.Fatal("Control Plane checkpoint did not persist the expected Step")
	}
	for _, variable := range snapshot.Variables {
		if variable.VariableId == "continued" {
			value, ok := variable.Value.GetValue().(*presentation.ScalarValue_BooleanValue)
			if !ok || value.BooleanValue != continued {
				f.t.Fatal("Control Plane checkpoint did not persist the expected continued variable")
			}
			return
		}
	}
	f.t.Fatal("Control Plane canonical checkpoint omitted the continued variable")
}
