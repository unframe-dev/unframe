package hostops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type UpdateConfig struct {
	Repository            string   `json:"repository"`
	Workflow              string   `json:"workflow"`
	Directory             string   `json:"directory"`
	DeploymentDirectory   string   `json:"deploymentDirectory"`
	GH                    string   `json:"gh"`
	ActivityCommand       []string `json:"activityCommand"`
	RestartCommand        []string `json:"restartCommand"`
	HealthCommand         []string `json:"healthCommand"`
	RollbackHealthCommand []string `json:"rollbackHealthCommand"`
}
type UpdateOptions struct {
	Force bool
	Check bool
}
type UpdateResult struct {
	Status         string `json:"status"`
	SHA            string `json:"sha,omitempty"`
	RunID          int64  `json:"runId,omitempty"`
	ActiveSessions int64  `json:"activeSessions,omitempty"`
	Rollback       string `json:"rollback,omitempty"`
	Message        string `json:"message,omitempty"`
	DrainRelease   string `json:"drainRelease,omitempty"`
}

var updateSHA = regexp.MustCompile(`^[0-9a-f]{40}$`)
var updateDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var updateArtifactName = regexp.MustCompile(`^runtime-host-darwin-arm64-[0-9a-f]{40}$`)

func LoadUpdateConfig(path string) (UpdateConfig, error) {
	var config UpdateConfig
	if !filepath.IsAbs(path) {
		return config, errors.New("updater config path must be absolute")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return config, errors.New("cannot read updater configuration")
	}
	if err = json.Unmarshal(data, &config); err != nil {
		return config, errors.New("invalid updater configuration")
	}
	return config, config.validate()
}
func (c UpdateConfig) validate() error {
	if c.Repository != "unframe-dev/unframe" || c.Workflow != "ci.yml" {
		return errors.New("unexpected repository or workflow")
	}
	for _, path := range []string{c.Directory, c.DeploymentDirectory, c.GH} {
		if !filepath.IsAbs(path) {
			return errors.New("updater configuration paths must be absolute")
		}
	}
	if filepath.Clean(c.Directory) == filepath.Clean(c.DeploymentDirectory) {
		return errors.New("updater and deployment directories must differ")
	}
	for _, cmd := range [][]string{c.ActivityCommand, c.RestartCommand, c.HealthCommand, c.RollbackHealthCommand} {
		if len(cmd) == 0 || !filepath.IsAbs(cmd[0]) {
			return errors.New("invalid updater management command")
		}
	}
	return nil
}
func updateIdentity(status string, run *updateRun) UpdateResult {
	return UpdateResult{Status: status, SHA: run.HeadSHA, RunID: run.ID}
}

// Update activates only verified successful main artifacts and rolls back an interrupted activation.
func Update(ctx context.Context, config UpdateConfig, options UpdateOptions) (result UpdateResult, err error) {
	if err = config.validate(); err != nil {
		return result, err
	}
	if options.Check {
		run, findErr := updateFindRun(ctx, config)
		if findErr != nil {
			return result, findErr
		}
		if run == nil {
			return UpdateResult{Status: "unavailable"}, nil
		}
		return updateIdentity("available", run), nil
	}
	if err = os.MkdirAll(config.Directory, 0700); err != nil {
		return result, err
	}
	if err = updatePrivateDirectory(config.Directory); err != nil {
		return result, err
	}
	unlock, lockErr := updateLock(config.Directory, "lock", 0)
	if lockErr != nil {
		return result, lockErr
	}
	if unlock == nil {
		return UpdateResult{Status: "locked"}, nil
	}
	release := filepath.Join(config.DeploymentDirectory, "release")
	binary := filepath.Join(release, "runtime-host")
	backup := filepath.Join(release, "runtime-host.previous")
	candidate := filepath.Join(release, ".runtime-host-"+updateRandom())
	statePath := filepath.Join(config.Directory, "state.json")
	pendingPath := filepath.Join(config.Directory, "pending.json")
	var state updateState
	var target *updateRun
	swapped, recovering := false, false
	defer func() {
		_ = os.Remove(candidate)
		// An interrupted command must not prevent rollback or release of the drain reservation.
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		_, releaseErr := updateCommand(cleanup, append(append([]string{}, config.ActivityCommand...), "release"), updateCommandLimit)
		if unlockErr := unlock(); unlockErr != nil {
			err = errors.Join(err, unlockErr)
		}
		if releaseErr != nil {
			result.Status = "failed"
			result.DrainRelease = "failed"
			result.Message = strings.TrimSpace(result.Message + " Could not release deployment drain reservation.")
		}
	}()
	transactionErr := func() error {
		if _, readErr := updateReadJSON(statePath, &state); readErr != nil {
			return errors.New("invalid updater state")
		}
		var pending updatePending
		exists, readErr := updateReadJSON(pendingPath, &pending)
		if readErr != nil {
			return errors.New("invalid pending update state")
		}
		if exists {
			if !updateSHA.MatchString(pending.SHA) || pending.RunID < 0 || pending.RunID > updateMaxSafeInteger || pending.PreviousState == nil {
				return errors.New("invalid pending update state")
			}
			target = &updateRun{ID: pending.RunID, HeadSHA: pending.SHA}
			active, prepareErr := updatePrepareActivity(ctx, config, options.Force)
			if prepareErr != nil {
				return prepareErr
			}
			if !options.Force && active > 0 {
				result = updateIdentity("deferred", target)
				result.ActiveSessions = active
				return nil
			}
			if ctx.Err() != nil {
				return errors.New("update interrupted before recovery")
			}
			recovering = true
			if copyErr := updateCopy(backup, candidate, 0755); copyErr != nil {
				return copyErr
			}
			if renameErr := os.Rename(candidate, binary); renameErr != nil {
				return renameErr
			}
			if syncErr := updateSync(release); syncErr != nil {
				return syncErr
			}
			if _, commandErr := updateCommand(ctx, config.RestartCommand, updateCommandLimit); commandErr != nil {
				return commandErr
			}
			if _, commandErr := updateCommand(ctx, config.RollbackHealthCommand, updateCommandLimit); commandErr != nil {
				return commandErr
			}
			state = *pending.PreviousState
			state.FailedSHA = pending.SHA
			state.FailedRunID = pending.RunID
			state.Rollback = "succeeded"
			state.FailedAt = time.Now().UTC().Format(time.RFC3339Nano)
			if writeErr := updateAtomicJSON(statePath, state); writeErr != nil {
				return writeErr
			}
			if removeErr := os.Remove(pendingPath); removeErr != nil {
				return removeErr
			}
			recovering = false
		}
		var findErr error
		target, findErr = updateFindRun(ctx, config)
		if findErr != nil {
			return findErr
		}
		if target == nil {
			result = UpdateResult{Status: "unavailable"}
			return nil
		}
		if (state.SHA == target.HeadSHA && state.FailedSHA != target.HeadSHA) || (!options.Force && state.RunID > target.ID) {
			result = UpdateResult{Status: "current", SHA: state.SHA, RunID: state.RunID}
			return nil
		}
		if !options.Force && state.FailedSHA == target.HeadSHA {
			result = updateIdentity("failed-previously", target)
			return nil
		}
		active, prepareErr := updatePrepareActivity(ctx, config, options.Force)
		if prepareErr != nil {
			return prepareErr
		}
		if !options.Force && active > 0 {
			result = updateIdentity("deferred", target)
			result.ActiveSessions = active
			return nil
		}
		archive, downloadErr := updateCommand(ctx, []string{config.GH, "api", fmt.Sprintf("repos/%s/actions/artifacts/%d/zip", config.Repository, target.Artifact.ID)}, updateArchiveLimit)
		if downloadErr != nil {
			return downloadErr
		}
		if "sha256:"+updateHash(archive) != target.Artifact.Digest {
			return errors.New("artifact digest mismatch")
		}
		bytes, archiveErr := updateReadArchive(archive, config.Repository, target.HeadSHA)
		if archiveErr != nil {
			return archiveErr
		}
		if ctx.Err() != nil {
			return errors.New("update interrupted before activation")
		}
		info, statErr := os.Lstat(binary)
		if statErr != nil {
			return statErr
		}
		if !info.Mode().IsRegular() {
			return errors.New("installed runtime-host must be a regular file")
		}
		if writeErr := updateWriteSynced(candidate, bytes, 0755); writeErr != nil {
			return writeErr
		}
		if copyErr := updateCopy(binary, backup+".tmp", 0755); copyErr != nil {
			return copyErr
		}
		if renameErr := os.Rename(backup+".tmp", backup); renameErr != nil {
			return renameErr
		}
		if syncErr := updateSync(release); syncErr != nil {
			return syncErr
		}
		if writeErr := updateAtomicJSON(pendingPath, updatePending{SHA: target.HeadSHA, RunID: target.ID, PreviousState: &state}); writeErr != nil {
			return writeErr
		}
		if renameErr := os.Rename(candidate, binary); renameErr != nil {
			return renameErr
		}
		swapped = true
		if syncErr := updateSync(release); syncErr != nil {
			return syncErr
		}
		if _, commandErr := updateCommand(ctx, config.RestartCommand, updateCommandLimit); commandErr != nil {
			return commandErr
		}
		if _, commandErr := updateCommand(ctx, config.HealthCommand, updateCommandLimit); commandErr != nil {
			return commandErr
		}
		if ctx.Err() != nil {
			return errors.New("update interrupted during activation")
		}
		if writeErr := updateAtomicJSON(statePath, updateState{SHA: target.HeadSHA, RunID: target.ID, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}); writeErr != nil {
			return writeErr
		}
		if removeErr := os.Remove(pendingPath); removeErr != nil {
			return removeErr
		}
		result = updateIdentity("updated", target)
		return nil
	}()
	if transactionErr == nil {
		return result, nil
	}
	rollback := "not-needed"
	if recovering {
		rollback = "failed"
	}
	if swapped {
		recovery, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Minute)
		defer cancel()
		rollback = "failed"
		if rollbackErr := func() error {
			if e := updateCopy(backup, candidate, 0755); e != nil {
				return e
			}
			if e := os.Rename(candidate, binary); e != nil {
				return e
			}
			if e := updateSync(release); e != nil {
				return e
			}
			if _, e := updateCommand(recovery, config.RestartCommand, updateCommandLimit); e != nil {
				return e
			}
			_, e := updateCommand(recovery, config.RollbackHealthCommand, updateCommandLimit)
			return e
		}(); rollbackErr == nil {
			rollback = "succeeded"
		}
	}
	if target != nil && (swapped || strings.Contains(transactionErr.Error(), "artifact") || strings.Contains(transactionErr.Error(), "ZIP")) {
		state.FailedSHA = target.HeadSHA
		state.FailedRunID = target.ID
		state.Rollback = rollback
		state.FailedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if writeErr := updateAtomicJSON(statePath, state); writeErr != nil {
			return result, errors.New("cannot record failed updater state")
		}
	}
	if swapped && rollback == "succeeded" {
		if removeErr := os.Remove(pendingPath); removeErr != nil && !os.IsNotExist(removeErr) {
			return result, removeErr
		}
	}
	result = UpdateResult{Status: "failed", Rollback: rollback, Message: transactionErr.Error()}
	if target != nil {
		result.SHA = target.HeadSHA
		result.RunID = target.ID
	}
	return result, nil
}
