package hostops

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

type updateState struct {
	SHA         string `json:"sha,omitempty"`
	RunID       int64  `json:"runId,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	FailedSHA   string `json:"failedSha,omitempty"`
	FailedRunID int64  `json:"failedRunId,omitempty"`
	FailedAt    string `json:"failedAt,omitempty"`
	Rollback    string `json:"rollback,omitempty"`
}
type updatePending struct {
	SHA           string       `json:"sha"`
	RunID         int64        `json:"runId"`
	PreviousState *updateState `json:"previousState"`
}

func (pending *updatePending) UnmarshalJSON(data []byte) error {
	var record struct {
		SHA           string       `json:"sha"`
		RunID         *int64       `json:"runId"`
		PreviousState *updateState `json:"previousState"`
	}
	if err := json.Unmarshal(data, &record); err != nil {
		return err
	}
	if record.RunID == nil || record.PreviousState == nil {
		return errors.New("incomplete pending update state")
	}
	pending.SHA, pending.RunID, pending.PreviousState = record.SHA, *record.RunID, record.PreviousState
	return nil
}

func updateRandom() string { return rand.Text() }
func updatePrivateDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || !ok || int(stat.Uid) != os.Getuid() || info.Mode().Perm()&0077 != 0 {
		return errors.New("updater directory must be private and owned by the current user")
	}
	return nil
}
func updateReadJSON(path string, value any) (bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return false, errors.New("invalid null state")
	}
	return true, json.Unmarshal(data, value)
}
func updateSync(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(file.Sync(), file.Close())
}
func updateWriteSynced(path string, data []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(data)
	return errors.Join(writeErr, file.Chmod(mode), file.Sync(), file.Close())
}
func updateAtomicJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temporary := path + "." + updateRandom() + ".tmp"
	defer func() { _ = os.Remove(temporary) }()
	if err = updateWriteSynced(temporary, append(data, '\n'), 0600); err != nil {
		return err
	}
	if err = os.Rename(temporary, path); err != nil {
		return err
	}
	return updateSync(filepath.Dir(path))
}
func updateCopy(source, destination string, mode os.FileMode) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("update backup must be a regular file")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = input.Close() }()
	// An earlier interrupted backup copy is not a trusted destination to follow.
	if err = os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	return errors.Join(copyErr, output.Chmod(mode), output.Sync(), output.Close())
}
func updateLock(directory, name string, depth int) (func() error, error) {
	if depth > 16 {
		return nil, errors.New("too many interrupted lock recoveries")
	}
	path := filepath.Join(directory, name)
	prepared, err := os.MkdirTemp(directory, "lock-")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(prepared) }()
	data, _ := json.Marshal(struct {
		PID int `json:"pid"`
	}{os.Getpid()})
	if err = os.WriteFile(filepath.Join(prepared, "owner.json"), data, 0600); err != nil {
		return nil, err
	}
	acquire := func() (bool, error) {
		e := os.Rename(prepared, path)
		if e == nil {
			return true, nil
		}
		if errors.Is(e, syscall.EEXIST) || errors.Is(e, syscall.ENOTEMPTY) {
			return false, nil
		}
		return false, e
	}
	deadOwner := func() bool {
		var owner struct {
			PID int `json:"pid"`
		}
		_, e := updateReadJSON(filepath.Join(path, "owner.json"), &owner)
		return e == nil && owner.PID > 0 && errors.Is(syscall.Kill(owner.PID, 0), syscall.ESRCH)
	}
	acquired, err := acquire()
	if err != nil {
		return nil, err
	}
	if !acquired {
		if !deadOwner() {
			return nil, nil
		}
		release, lockErr := updateLock(directory, name+".reclaim", depth+1)
		if lockErr != nil {
			return nil, lockErr
		}
		if release == nil {
			return nil, nil
		}
		defer func() { _ = release() }()
		if !deadOwner() {
			return nil, nil
		}
		if err = os.RemoveAll(path); err != nil {
			return nil, err
		}
		acquired, err = acquire()
		if err != nil {
			return nil, err
		}
		if !acquired {
			return nil, nil
		}
	}
	return func() error { return os.RemoveAll(path) }, nil
}
