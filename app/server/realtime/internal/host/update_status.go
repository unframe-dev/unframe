package host

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// UpdateStatus describes only the local information needed to authorize an update.
type UpdateStatus struct {
	SchemaVersion  int       `json:"schemaVersion"`
	PID            int       `json:"pid"`
	UpdatedAt      time.Time `json:"updatedAt"`
	Draining       bool      `json:"draining"`
	ActiveSessions int       `json:"activeSessions"`
}

func privateUpdatePath(path string, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) || info.Mode()&os.ModeSymlink != 0 || info.IsDir() != directory || (!directory && !info.Mode().IsRegular()) || info.Mode().Perm()&0077 != 0 {
		return errors.New("update control path must be private and owned by the current user")
	}
	return nil
}
func updateDirectory(directory string) error {
	if !filepath.IsAbs(directory) {
		return errors.New("update control directory must be absolute")
	}
	if err := os.Mkdir(directory, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	return privateUpdatePath(directory, true)
}
func updateDrain(directory string) (bool, error) {
	if err := updateDirectory(directory); err != nil {
		return false, err
	}
	err := privateUpdatePath(filepath.Join(directory, "drain"), false)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

// SetUpdateDrain prevents new assignments until explicitly released.
func SetUpdateDrain(directory string, drain bool) error {
	if err := updateDirectory(directory); err != nil {
		return err
	}
	path := filepath.Join(directory, "drain")
	if !drain {
		if err := privateUpdatePath(path, false); errors.Is(err, os.ErrNotExist) {
			return nil
		} else if err != nil {
			return err
		}
		return os.Remove(path)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		return privateUpdatePath(path, false)
	}
	if err != nil {
		return err
	}
	return file.Close()
}
func writeUpdateStatus(directory string, status UpdateStatus) error {
	if err := updateDirectory(directory); err != nil {
		return err
	}
	data, err := json.Marshal(status)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(directory, ".status-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(file.Name()) }()
	if _, err = file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(directory, "status.json"))
}

// ReadUpdateStatus rejects stale data and dead hosts rather than allowing an update.
func ReadUpdateStatus(directory string, now time.Time) (UpdateStatus, error) {
	var status UpdateStatus
	if err := updateDirectory(directory); err != nil {
		return status, err
	}
	path := filepath.Join(directory, "status.json")
	if err := privateUpdatePath(path, false); err != nil {
		return status, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return status, err
	}
	if err = json.Unmarshal(data, &status); err != nil {
		return status, err
	}
	age := now.Sub(status.UpdatedAt)
	if status.SchemaVersion != 1 || status.PID <= 0 || status.ActiveSessions < 0 || age < 0 || age > 15*time.Second || syscall.Kill(status.PID, 0) != nil {
		return UpdateStatus{}, errors.New("update status is invalid, stale, or its host is not alive")
	}
	return status, nil
}
