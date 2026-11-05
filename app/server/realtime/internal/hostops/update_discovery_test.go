package hostops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdateDiscoversArtifactFromLargeGitHubResponses(t *testing.T) {
	gh, err := exec.LookPath("gh")
	if err != nil {
		t.Skip("GitHub CLI is required to exercise its JSON projection")
	}
	f := updateMakeFixture(t)
	artifactPath := filepath.Join(f.root, "artifacts.json")
	var artifacts map[string]any
	if err := json.Unmarshal([]byte(updateRead(t, artifactPath)), &artifacts); err != nil {
		t.Fatal(err)
	}
	artifacts["unused_metadata"] = strings.Repeat("x", updateCommandLimit+1)
	updateJSON(t, artifactPath, artifacts)

	runPath := filepath.Join(f.root, "runs.json")
	var runs map[string][]map[string]any
	if err := json.Unmarshal([]byte(updateRead(t, runPath)), &runs); err != nil {
		t.Fatal(err)
	}
	valid := runs["workflow_runs"][0]
	updateJSON(t, filepath.Join(f.root, "runs-page-2.json"), runs)
	invalid := []struct {
		field string
		value any
	}{
		{"id", -1},
		{"head_sha", "invalid"},
		{"head_branch", "feature"},
		{"event", "pull_request"},
		{"status", "in_progress"},
		{"conclusion", "failure"},
		{"head_repository", map[string]any{"full_name": "attacker/unframe"}},
	}
	firstPage := make([]map[string]any, 100)
	for i := range firstPage {
		run := make(map[string]any, len(valid)+1)
		for field, value := range valid {
			run[field] = value
		}
		change := invalid[i%len(invalid)]
		run[change.field] = change.value
		run["unused_metadata"] = strings.Repeat("x", 12000)
		firstPage[i] = run
	}
	updateJSON(t, runPath, map[string]any{"workflow_runs": firstPage})

	secondPageRequested := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := runPath
		if strings.HasSuffix(r.URL.Path, "/artifacts") {
			path = artifactPath
		} else if r.URL.Query().Get("page") == "2" {
			secondPageRequested <- struct{}{}
			path = filepath.Join(f.root, "runs-page-2.json")
		}
		w.Header().Set("Content-Type", "application/json")
		http.ServeFile(w, r, path)
	}))
	defer server.Close()
	t.Setenv("UPDATE_TEST_GH", gh)
	t.Setenv("UPDATE_TEST_API", server.URL)
	t.Setenv("GH_TOKEN", "local-test-token")
	t.Setenv("GH_CONFIG_DIR", t.TempDir())
	updateWrite(t, f.config.GH, `#!/bin/sh
endpoint="$2"
shift 2
exec "$UPDATE_TEST_GH" api "$UPDATE_TEST_API/$endpoint" "$@"
`, 0700)

	result, err := Update(context.Background(), f.config, UpdateOptions{Check: true})
	if err != nil || result.Status != "available" || result.RunID != 1 || result.SHA != updateTestSHA {
		t.Fatalf("%+v %v", result, err)
	}
	select {
	case <-secondPageRequested:
	default:
		t.Fatal("untrusted first-page runs were accepted without checking the next page")
	}
}

func TestUpdateRejectsOversizedDiscoveryOutput(t *testing.T) {
	f := updateMakeFixture(t)
	updateJSON(t, filepath.Join(f.root, "artifacts.json"), map[string]any{"artifacts": []any{map[string]any{"name": strings.Repeat("x", updateCommandLimit+1)}}})
	_, err := Update(context.Background(), f.config, UpdateOptions{Check: true})
	if err == nil {
		t.Fatal("oversized command output was accepted")
	}
}
