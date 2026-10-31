package hostops

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"time"
)

const updateMaxSafeInteger = int64(9007199254740991)
const updateCommandLimit = 1024 * 1024
const updateArchiveLimit = 100 * 1024 * 1024
const updateBinaryLimit = 200 * 1024 * 1024

type updateLimitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *updateLimitedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, errors.New("command output limit exceeded")
	}
	return b.Buffer.Write(p)
}
func updateCommand(ctx context.Context, args []string, limit int) ([]byte, error) {
	if len(args) == 0 {
		return nil, errors.New("invalid external command")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, args[0], args[1:]...)
	command.WaitDelay = time.Second
	output := &updateLimitedBuffer{limit: limit}
	command.Stdout = output
	if err := command.Run(); err != nil {
		return nil, errors.New("external command failed or timed out")
	}
	return output.Bytes(), nil
}
func updateJSONCommand(ctx context.Context, args []string, out any) error {
	data, err := updateCommand(ctx, args, updateCommandLimit)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(data, out); err != nil {
		return errors.New("external command returned invalid JSON")
	}
	return nil
}
func updatePrepareActivity(ctx context.Context, c UpdateConfig, force bool) (int64, error) {
	var activity struct {
		ActiveSessions *int64 `json:"activeSessions"`
	}
	err := updateJSONCommand(ctx, append(append([]string{}, c.ActivityCommand...), "prepare"), &activity)
	if err == nil && (activity.ActiveSessions == nil || *activity.ActiveSessions < 0 || *activity.ActiveSessions > updateMaxSafeInteger) {
		err = errors.New("invalid session activity response")
	}
	if err != nil {
		if force {
			return 0, nil
		}
		return 0, err
	}
	return *activity.ActiveSessions, nil
}

type updateArtifact struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Expired     bool   `json:"expired"`
	Digest      string `json:"digest"`
	WorkflowRun struct {
		ID int64 `json:"id"`
	} `json:"workflow_run"`
}
type updateRun struct {
	ID             int64  `json:"id"`
	HeadSHA        string `json:"head_sha"`
	HeadBranch     string `json:"head_branch"`
	Event          string `json:"event"`
	Status         string `json:"status"`
	Conclusion     string `json:"conclusion"`
	HeadRepository struct {
		FullName string `json:"full_name"`
	} `json:"head_repository"`
	Artifact updateArtifact `json:"-"`
}

func updateFindRun(ctx context.Context, c UpdateConfig) (*updateRun, error) {
	var response struct {
		Artifacts *[]updateArtifact `json:"artifacts"`
	}
	if err := updateJSONCommand(ctx, []string{c.GH, "api", fmt.Sprintf("repos/%s/actions/artifacts?per_page=100", c.Repository)}, &response); err != nil {
		return nil, err
	}
	if response.Artifacts == nil {
		return nil, errors.New("invalid artifact response")
	}
	artifacts := []updateArtifact{}
	oldest := updateMaxSafeInteger
	for _, a := range *response.Artifacts {
		if !a.Expired && updateArtifactName.MatchString(a.Name) && a.WorkflowRun.ID > 0 && a.WorkflowRun.ID <= updateMaxSafeInteger {
			artifacts = append(artifacts, a)
			if a.WorkflowRun.ID < oldest {
				oldest = a.WorkflowRun.ID
			}
		}
	}
	if len(artifacts) == 0 {
		return nil, nil
	}
	for page := 1; ; page++ {
		var response struct {
			Runs *[]updateRun `json:"workflow_runs"`
		}
		if err := updateJSONCommand(ctx, []string{c.GH, "api", fmt.Sprintf("repos/%s/actions/workflows/%s/runs?branch=main&event=push&status=success&per_page=100&page=%d", c.Repository, c.Workflow, page)}, &response); err != nil {
			return nil, err
		}
		if response.Runs == nil {
			return nil, errors.New("invalid workflow response")
		}
		allOlder := true
		for _, run := range *response.Runs {
			if run.ID >= oldest {
				allOlder = false
			}
			if run.ID <= 0 || run.ID > updateMaxSafeInteger || run.Status != "completed" || run.Conclusion != "success" || run.Event != "push" || run.HeadBranch != "main" || run.HeadRepository.FullName != c.Repository || !updateSHA.MatchString(run.HeadSHA) {
				continue
			}
			matches := 0
			for _, a := range artifacts {
				if a.WorkflowRun.ID == run.ID && a.Name == "runtime-host-darwin-arm64-"+run.HeadSHA {
					matches++
					run.Artifact = a
				}
			}
			if matches > 1 {
				return nil, errors.New("ambiguous deployment artifacts")
			}
			if matches == 1 {
				if run.Artifact.ID <= 0 || run.Artifact.ID > updateMaxSafeInteger || !updateDigest.MatchString(run.Artifact.Digest) {
					return nil, errors.New("artifact digest is missing or invalid")
				}
				return &run, nil
			}
		}
		if len(*response.Runs) < 100 || allOlder {
			return nil, nil
		}
	}
}
