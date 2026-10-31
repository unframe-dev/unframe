package hostops

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

const updateTestSHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type updateFixture struct {
	config        UpdateConfig
	root, release string
}

func updateWrite(t *testing.T, path, data string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), mode); err != nil {
		t.Fatal(err)
	}
}
func updateJSON(t *testing.T, path string, data any) {
	t.Helper()
	b, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	updateWrite(t, path, string(b), 0600)
}
func updateRead(t *testing.T, path string) string {
	t.Helper()
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	return string(b)
}
func updateMakeFixture(t *testing.T) updateFixture {
	t.Helper()
	root := t.TempDir()
	release := filepath.Join(root, "deployment", "release")
	if e := os.MkdirAll(release, 0700); e != nil {
		t.Fatal(e)
	}
	updateWrite(t, filepath.Join(release, "runtime-host"), "old binary", 0755)
	manifest := map[string]any{"schemaVersion": 1, "repository": "unframe-dev/unframe", "sha": updateTestSHA, "platform": "darwin", "arch": "arm64", "sha256": fmt.Sprintf("%x", sha256.Sum256([]byte("new binary")))}
	var archive bytes.Buffer
	w := zip.NewWriter(&archive)
	for _, f := range []struct {
		name string
		data []byte
	}{{"runtime-host", []byte("new binary")}, {"manifest.json", func() []byte { b, _ := json.Marshal(manifest); return b }()}} {
		out, e := w.Create(f.name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = out.Write(f.data); e != nil {
			t.Fatal(e)
		}
	}
	if e := w.Close(); e != nil {
		t.Fatal(e)
	}
	updateWrite(t, filepath.Join(root, "artifact.zip"), archive.String(), 0600)
	digest := sha256.Sum256(archive.Bytes())
	updateJSON(t, filepath.Join(root, "artifacts.json"), map[string]any{"artifacts": []any{map[string]any{"id": 2, "workflow_run": map[string]any{"id": 1}, "name": "runtime-host-darwin-arm64-" + updateTestSHA, "expired": false, "digest": "sha256:" + hex.EncodeToString(digest[:])}}})
	updateJSON(t, filepath.Join(root, "runs.json"), map[string]any{"workflow_runs": []any{map[string]any{"id": 1, "head_sha": updateTestSHA, "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success", "head_repository": map[string]any{"full_name": "unframe-dev/unframe"}}}})
	gh := filepath.Join(root, "gh")
	updateWrite(t, gh, `#!/bin/sh
cd "$(dirname "$0")"
printf '%s\n' "$2" >> api.log
case "$2" in */zip) cat artifact.zip;; */actions/artifacts\?*) cat artifacts.json;; *) cat runs.json;; esac
`, 0700)
	command := filepath.Join(root, "command")
	updateWrite(t, command, `#!/bin/sh
cd "$(dirname "$0")"
printf '%s\n' "$*" >> commands.log
case "$1 $2" in
 'activity prepare') [ ! -f activity-fails ] || exit 1; if [ -f active ]; then printf '{"activeSessions":2}\n'; else printf '{"activeSessions":0}\n'; fi;;
 'activity release') [ ! -f release-fails ] || exit 1;;
 'health ') [ ! -f health-fails ] || exit 1;;
 'rollback-health ') [ ! -f rollback-fails ] || exit 1;;
esac
`, 0700)
	return updateFixture{UpdateConfig{Repository: "unframe-dev/unframe", Workflow: "ci.yml", Directory: filepath.Join(root, "state"), DeploymentDirectory: filepath.Join(root, "deployment"), GH: gh, ActivityCommand: []string{command, "activity"}, RestartCommand: []string{command, "restart"}, HealthCommand: []string{command, "health"}, RollbackHealthCommand: []string{command, "rollback-health"}}, root, release}
}
func TestUpdateInstallsVerifiedMainArtifact(t *testing.T) {
	f := updateMakeFixture(t)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil {
		t.Fatal(e)
	}
	if r.Status != "updated" || r.SHA != updateTestSHA || r.RunID != 1 {
		t.Fatalf("%+v", r)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "new binary" {
		t.Fatal(got)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host.previous")); got != "old binary" {
		t.Fatal(got)
	}
	if !strings.Contains(updateRead(t, filepath.Join(f.config.Directory, "state.json")), updateTestSHA) {
		t.Fatal("SHA not saved")
	}
}

func TestUpdateDefersActiveSessionsAndReleasesDrain(t *testing.T) {
	f := updateMakeFixture(t)
	updateWrite(t, filepath.Join(f.root, "active"), "", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "deferred" || r.ActiveSessions != 2 {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.root, "commands.log")); got != "activity prepare\nactivity release\n" {
		t.Fatal(got)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
		t.Fatal(got)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{Force: true})
	if e != nil || r.Status != "updated" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateCheckDoesNotCreateStateOrDrain(t *testing.T) {
	f := updateMakeFixture(t)
	r, e := Update(context.Background(), f.config, UpdateOptions{Check: true})
	if e != nil || r.Status != "available" || r.SHA != updateTestSHA || r.RunID != 1 {
		t.Fatalf("%+v %v", r, e)
	}
	for _, path := range []string{f.config.Directory, filepath.Join(f.root, "commands.log")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("check created %s: %v", path, err)
		}
	}
}
func TestUpdateFailedHealthRollsBackAndBlocksAutomaticRetry(t *testing.T) {
	f := updateMakeFixture(t)
	updateWrite(t, filepath.Join(f.root, "health-fails"), "", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || r.Rollback != "succeeded" {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
		t.Fatal(got)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed-previously" {
		t.Fatalf("%+v %v", r, e)
	}
	if e = os.Remove(filepath.Join(f.root, "health-fails")); e != nil {
		t.Fatal(e)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{Force: true})
	if e != nil || r.Status != "updated" {
		t.Fatalf("%+v %v", r, e)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{Force: true})
	if e != nil || r.Status != "current" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateRefusesMismatchedDigest(t *testing.T) {
	f := updateMakeFixture(t)
	data := updateRead(t, filepath.Join(f.root, "artifacts.json"))
	re := regexp.MustCompile(`sha256:[0-9a-f]{64}`)
	updateWrite(t, filepath.Join(f.root, "artifacts.json"), re.ReplaceAllString(data, "sha256:"+strings.Repeat("0", 64)), 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || !strings.Contains(r.Message, "digest mismatch") {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
		t.Fatal(got)
	}
}
func TestUpdateLocksCannotBeTakenFromLiveOwner(t *testing.T) {
	f := updateMakeFixture(t)
	if e := os.MkdirAll(filepath.Join(f.config.Directory, "lock"), 0700); e != nil {
		t.Fatal(e)
	}
	updateJSON(t, filepath.Join(f.config.Directory, "lock", "owner.json"), map[string]any{"pid": os.Getpid()})
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "locked" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateReclaimsInterruptedLockRecovery(t *testing.T) {
	f := updateMakeFixture(t)
	for _, name := range []string{"lock", "lock.reclaim"} {
		if e := os.MkdirAll(filepath.Join(f.config.Directory, name), 0700); e != nil {
			t.Fatal(e)
		}
		updateJSON(t, filepath.Join(f.config.Directory, name, "owner.json"), map[string]any{"pid": 2147483647})
	}
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "updated" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateRefusesSharedStateDirectory(t *testing.T) {
	f := updateMakeFixture(t)
	if e := os.Mkdir(f.config.Directory, 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.Chmod(f.config.Directory, 0755); e != nil {
		t.Fatal(e)
	}
	if _, e := Update(context.Background(), f.config, UpdateOptions{}); e == nil || !strings.Contains(e.Error(), "private and owned") {
		t.Fatal(e)
	}
}
func TestUpdateActivityFailureCanRetryWithoutFailureSuppression(t *testing.T) {
	f := updateMakeFixture(t)
	updateWrite(t, filepath.Join(f.root, "activity-fails"), "", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" {
		t.Fatalf("%+v %v", r, e)
	}
	if e = os.Remove(filepath.Join(f.root, "activity-fails")); e != nil {
		t.Fatal(e)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "updated" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateForcePermitsUnknownActivity(t *testing.T) {
	f := updateMakeFixture(t)
	updateWrite(t, filepath.Join(f.root, "activity-fails"), "", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{Force: true})
	if e != nil || r.Status != "updated" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateDoesNotAutomaticallyDowngrade(t *testing.T) {
	f := updateMakeFixture(t)
	if e := os.Mkdir(f.config.Directory, 0700); e != nil {
		t.Fatal(e)
	}
	updateJSON(t, filepath.Join(f.config.Directory, "state.json"), map[string]any{"sha": strings.Repeat("b", 40), "runId": 3})
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "current" || r.RunID != 3 {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
		t.Fatal(got)
	}
}
func TestUpdateDrainReleaseFailureCanBeClearedByCurrentRun(t *testing.T) {
	f := updateMakeFixture(t)
	updateWrite(t, filepath.Join(f.root, "release-fails"), "", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || r.DrainRelease != "failed" {
		t.Fatalf("%+v %v", r, e)
	}
	if e = os.Remove(filepath.Join(f.root, "release-fails")); e != nil {
		t.Fatal(e)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "current" {
		t.Fatalf("%+v %v", r, e)
	}
	if !strings.HasSuffix(updateRead(t, filepath.Join(f.root, "commands.log")), "activity release\n") {
		t.Fatal("drain not released")
	}
}
func TestUpdateNoArtifactsStopsDiscoveryAfterOneRequest(t *testing.T) {
	f := updateMakeFixture(t)
	updateJSON(t, filepath.Join(f.root, "artifacts.json"), map[string]any{"artifacts": []any{}})
	r, e := Update(context.Background(), f.config, UpdateOptions{Check: true})
	if e != nil || r.Status != "unavailable" {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.root, "api.log")); got != "repos/unframe-dev/unframe/actions/artifacts?per_page=100\n" {
		t.Fatal(got)
	}
}
func TestUpdateForeignRepositoryCannotBeCandidate(t *testing.T) {
	f := updateMakeFixture(t)
	path := filepath.Join(f.root, "runs.json")
	updateWrite(t, path, strings.ReplaceAll(updateRead(t, path), "unframe-dev/unframe", "attacker/unframe"), 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{Check: true})
	if e != nil || r.Status != "unavailable" {
		t.Fatalf("%+v %v", r, e)
	}
}
func updatePendingFixture(t *testing.T, f updateFixture) {
	t.Helper()
	if e := os.Mkdir(f.config.Directory, 0700); e != nil {
		t.Fatal(e)
	}
	updateWrite(t, filepath.Join(f.release, "runtime-host"), "new binary", 0755)
	updateWrite(t, filepath.Join(f.release, "runtime-host.previous"), "old binary", 0755)
	updateJSON(t, filepath.Join(f.config.Directory, "pending.json"), map[string]any{"sha": updateTestSHA, "runId": 1, "previousState": map[string]any{"sha": strings.Repeat("b", 40), "runId": 0}})
}
func TestUpdateRecoversPendingTransactionBeforeDiscovery(t *testing.T) {
	f := updateMakeFixture(t)
	updatePendingFixture(t, f)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed-previously" {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
		t.Fatal(got)
	}
	if _, e = os.Stat(filepath.Join(f.config.Directory, "pending.json")); !os.IsNotExist(e) {
		t.Fatal(e)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{Force: true})
	if e != nil || r.Status != "updated" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdatePendingRecoveryDefersActiveAndUnknownActivity(t *testing.T) {
	for _, marker := range []string{"active", "activity-fails"} {
		t.Run(marker, func(t *testing.T) {
			f := updateMakeFixture(t)
			updatePendingFixture(t, f)
			updateWrite(t, filepath.Join(f.root, marker), "", 0600)
			r, e := Update(context.Background(), f.config, UpdateOptions{})
			want := "deferred"
			if marker == "activity-fails" {
				want = "failed"
			}
			if e != nil || r.Status != want {
				t.Fatalf("%+v %v", r, e)
			}
			if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "new binary" {
				t.Fatal(got)
			}
			if _, e = os.Stat(filepath.Join(f.config.Directory, "pending.json")); e != nil {
				t.Fatal(e)
			}
			r, e = Update(context.Background(), f.config, UpdateOptions{Force: true})
			if e != nil || r.Status != "updated" {
				t.Fatalf("%+v %v", r, e)
			}
		})
	}
}
func TestUpdateFailedRecoveryRetainsPendingAndBackup(t *testing.T) {
	f := updateMakeFixture(t)
	updatePendingFixture(t, f)
	updateWrite(t, filepath.Join(f.root, "rollback-fails"), "", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || r.Rollback != "failed" {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host.previous")); got != "old binary" {
		t.Fatal(got)
	}
	if _, e = os.Stat(filepath.Join(f.config.Directory, "pending.json")); e != nil {
		t.Fatal(e)
	}
	if e = os.Remove(filepath.Join(f.root, "rollback-fails")); e != nil {
		t.Fatal(e)
	}
	r, e = Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed-previously" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateFailedRollbackIsExplicit(t *testing.T) {
	f := updateMakeFixture(t)
	updateWrite(t, filepath.Join(f.root, "health-fails"), "", 0600)
	updateWrite(t, filepath.Join(f.root, "rollback-fails"), "", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || r.Rollback != "failed" {
		t.Fatalf("%+v %v", r, e)
	}
	if _, e = os.Stat(filepath.Join(f.config.Directory, "pending.json")); e != nil {
		t.Fatal(e)
	}
}

func updateReplaceArchive(t *testing.T, f updateFixture, entries []struct {
	name string
	data string
	mode os.FileMode
}) {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		header.SetMode(entry.mode)
		out, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = out.Write([]byte(entry.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	updateWrite(t, filepath.Join(f.root, "artifact.zip"), archive.String(), 0600)
	path := filepath.Join(f.root, "artifacts.json")
	source := updateRead(t, path)
	re := regexp.MustCompile(`sha256:[0-9a-f]{64}`)
	updateWrite(t, path, re.ReplaceAllString(source, "sha256:"+fmt.Sprintf("%x", sha256.Sum256(archive.Bytes()))), 0600)
}
func TestUpdateRejectsUnsafeArchiveEntries(t *testing.T) {
	for _, entry := range []struct {
		name string
		mode os.FileMode
	}{{"extra", 0600}, {"../runtime-host", 0755}, {"runtime-host", os.ModeSymlink | 0755}, {"manifest.json", 0600}} {
		t.Run(fmt.Sprint(entry), func(t *testing.T) {
			f := updateMakeFixture(t)
			updateReplaceArchive(t, f, []struct {
				name string
				data string
				mode os.FileMode
			}{{"manifest.json", "{}", 0600}, {entry.name, "untrusted", entry.mode}})
			r, e := Update(context.Background(), f.config, UpdateOptions{})
			if e != nil || r.Status != "failed" || !strings.Contains(r.Message, "ZIP") {
				t.Fatalf("%+v %v", r, e)
			}
			if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
				t.Fatal(got)
			}
		})
	}
}
func TestUpdateRejectsManifestForDifferentCommit(t *testing.T) {
	f := updateMakeFixture(t)
	manifest := fmt.Sprintf(`{"schemaVersion":1,"repository":"unframe-dev/unframe","sha":"%s","platform":"darwin","arch":"arm64","sha256":"%x"}`, strings.Repeat("b", 40), sha256.Sum256([]byte("new binary")))
	updateReplaceArchive(t, f, []struct {
		name string
		data string
		mode os.FileMode
	}{{"manifest.json", manifest, 0600}, {"runtime-host", "new binary", 0755}})
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || !strings.Contains(r.Message, "manifest mismatch") {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateCancellationCompletesRollbackAndDrainRelease(t *testing.T) {
	f := updateMakeFixture(t)
	marker := filepath.Join(f.root, "health-entered")
	f.config.HealthCommand = []string{"/bin/sh", "-c", `touch "$1"; exec sleep 20`, "health", marker}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		for {
			if _, err := os.Stat(marker); err == nil {
				cancel()
				return
			}
			select {
			case <-finished:
				return
			case <-time.After(5 * time.Millisecond):
			}
		}
	}()
	r, e := Update(ctx, f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || r.Rollback != "succeeded" {
		t.Fatalf("%+v %v", r, e)
	}
	if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
		t.Fatal(got)
	}
	if !strings.HasSuffix(updateRead(t, filepath.Join(f.root, "commands.log")), "rollback-health\nactivity release\n") {
		t.Fatal("cancelled update did not complete cleanup")
	}
}
func TestUpdateNewerCIWithoutArtifactDoesNotHidePreviousRelease(t *testing.T) {
	f := updateMakeFixture(t)
	path := filepath.Join(f.root, "runs.json")
	var data map[string][]map[string]any
	if e := json.Unmarshal([]byte(updateRead(t, path)), &data); e != nil {
		t.Fatal(e)
	}
	newer := map[string]any{"id": 2, "head_sha": strings.Repeat("b", 40), "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success", "head_repository": map[string]any{"full_name": "unframe-dev/unframe"}}
	data["workflow_runs"] = append([]map[string]any{newer}, data["workflow_runs"]...)
	updateJSON(t, path, data)
	r, e := Update(context.Background(), f.config, UpdateOptions{Check: true})
	if e != nil || r.Status != "available" || r.RunID != 1 {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateRefusesMalformedActivity(t *testing.T) {
	f := updateMakeFixture(t)
	command := filepath.Join(f.root, "invalid-activity")
	updateWrite(t, command, "#!/bin/sh\nprintf '{\"activeSessions\":null}\\n'\n", 0700)
	f.config.ActivityCommand = []string{command}
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || !strings.Contains(r.Message, "activity response") {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestUpdateRejectsNullPendingTransaction(t *testing.T) {
	f := updateMakeFixture(t)
	if e := os.Mkdir(f.config.Directory, 0700); e != nil {
		t.Fatal(e)
	}
	updateWrite(t, filepath.Join(f.config.Directory, "pending.json"), " null\n", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || !strings.Contains(r.Message, "pending update state") {
		t.Fatalf("%+v %v", r, e)
	}
}

func TestUpdateRejectsNullSavedState(t *testing.T) {
	f := updateMakeFixture(t)
	if e := os.Mkdir(f.config.Directory, 0700); e != nil {
		t.Fatal(e)
	}
	updateWrite(t, filepath.Join(f.config.Directory, "state.json"), " null\n", 0600)
	r, e := Update(context.Background(), f.config, UpdateOptions{})
	if e != nil || r.Status != "failed" || !strings.Contains(r.Message, "updater state") {
		t.Fatalf("%+v %v", r, e)
	}
}

func TestUpdateRejectsIncompletePendingIdentity(t *testing.T) {
	for _, value := range []string{"missing", "null"} {
		t.Run(value, func(t *testing.T) {
			f := updateMakeFixture(t)
			if err := os.Mkdir(f.config.Directory, 0700); err != nil {
				t.Fatal(err)
			}
			pending := map[string]any{"sha": updateTestSHA, "previousState": map[string]any{}}
			if value == "null" {
				pending["runId"] = nil
			}
			updateJSON(t, filepath.Join(f.config.Directory, "pending.json"), pending)
			result, err := Update(context.Background(), f.config, UpdateOptions{})
			if err != nil || result.Status != "failed" || !strings.Contains(result.Message, "pending update state") {
				t.Fatalf("%+v %v", result, err)
			}
			if got := updateRead(t, filepath.Join(f.root, "commands.log")); got != "activity release\n" {
				t.Fatal(got)
			}
			if got := updateRead(t, filepath.Join(f.release, "runtime-host")); got != "old binary" {
				t.Fatal(got)
			}
		})
	}
}
