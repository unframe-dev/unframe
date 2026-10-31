package hostops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
)

const updaterLabel = "me.un-fra.realtime-updater"

type SetupOptions struct {
	Output, DeploymentDirectory, Home, Executable string
	Install                                       bool
}

func SetupUpdater(ctx context.Context, options SetupOptions) error {
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" || os.Getuid() == 0 {
		return errors.New("run setup as the non-root service user on an arm64 Mac")
	}
	if options.Home == "" {
		options.Home = os.Getenv("HOME")
	}
	if options.Output == "" {
		options.Output = filepath.Join(options.Home, "Library/Application Support/Unframe/RealtimeUpdater")
	}
	if options.DeploymentDirectory == "" {
		options.DeploymentDirectory = filepath.Join(options.Home, "Library/Application Support/Unframe/Funnel")
	}
	gh, err := deployFindTool("gh")
	if err != nil {
		return err
	}
	store, err := deployStore(gh)
	if err != nil {
		return err
	}
	if _, err = deployRun(ctx, gh, "api", "repos/unframe-dev/unframe/actions/workflows/ci.yml", "--jq", ".id"); err != nil {
		return err
	}
	if err = prepareUpdaterFiles(options, gh); err != nil {
		return err
	}
	if err = os.Mkdir(filepath.Join(options.Output, "nix-roots"), 0700); err != nil {
		_ = os.RemoveAll(options.Output)
		return err
	}
	if err = deployAddRoot(ctx, filepath.Join(options.Output, "nix-roots/gh"), store); err != nil {
		_ = os.RemoveAll(options.Output)
		return err
	}
	if options.Install {
		cmd := exec.CommandContext(ctx, "/bin/bash", filepath.Join(options.Output, "install.sh"))
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err = cmd.Run(); err != nil {
			return errors.New("updater installer failed; inspect the prepared deployment")
		}
	}
	fmt.Printf("Prepared updater: %s\nInstall: /bin/bash %s\nUpdate immediately: %s\nCheck: %s --check\n", options.Output, deployShell(filepath.Join(options.Output, "install.sh")), deployShell(filepath.Join(options.Output, "update")), deployShell(filepath.Join(options.Output, "update")))
	return nil
}
func prepareUpdaterFiles(options SetupOptions, gh string) (err error) {
	executable, err := deployExecutable(options.Executable)
	if err != nil {
		return err
	}
	for _, path := range []string{options.Output, options.DeploymentDirectory, options.Home, executable, gh} {
		if !filepath.IsAbs(path) {
			return errors.New("updater paths must be absolute")
		}
	}
	for _, path := range []string{options.DeploymentDirectory, filepath.Join(options.DeploymentDirectory, "release/runtime-host")} {
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || info.Mode()&os.ModeSymlink != 0 || int(owner.Uid) != os.Getuid() || info.Mode().Perm()&0022 != 0 {
			return errors.New("deployment must be owned by the service user and not writable by others")
		}
	}
	var deployment struct {
		Home    string `json:"home"`
		EnvFile string `json:"envFile"`
	}
	data, err := os.ReadFile(filepath.Join(options.DeploymentDirectory, "config.json"))
	if err != nil {
		return err
	}
	if json.Unmarshal(data, &deployment) != nil || deployment.Home != options.Home || !filepath.IsAbs(deployment.EnvFile) {
		return errors.New("funnel deployment does not belong to this user")
	}
	if err = deployPrivatePath(deployment.EnvFile, os.Getuid(), true); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(options.Output), 0700); err != nil {
		return err
	}
	if err = os.Mkdir(options.Output, 0700); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(options.Output)
		}
	}()
	for _, name := range []string{"logs", "state"} {
		if err = os.Mkdir(filepath.Join(options.Output, name), 0700); err != nil {
			return err
		}
	}
	admin := filepath.Join(options.Output, "runtime-host-admin")
	if err = deployCopy(executable, admin, 0700); err != nil {
		return err
	}
	command := []string{admin, "--deployment", options.DeploymentDirectory}
	config := UpdateConfig{
		Repository:            "unframe-dev/unframe",
		Workflow:              "ci.yml",
		Directory:             filepath.Join(options.Output, "state"),
		DeploymentDirectory:   options.DeploymentDirectory,
		GH:                    gh,
		ActivityCommand:       append(append([]string{}, command...), "activity"),
		RestartCommand:        append(append([]string{}, command...), "restart"),
		HealthCommand:         append(append([]string{}, command...), "health"),
		RollbackHealthCommand: append(append([]string{}, command...), "rollback-health"),
	}
	if err = deployJSON(filepath.Join(options.Output, "config.json"), config); err != nil {
		return err
	}
	update := fmt.Sprintf(`#!/bin/bash
set -euo pipefail
umask 077
export HOME=%s
export GH_HOST=github.com
case "${1:-}" in
 --auto) shift ;;
 --check) ;;
 "") set -- --force ;;
 *) echo 'usage: update [--auto | --check]' >&2; exit 2 ;;
esac
exec %s update --config %s "$@"
`, deployShell(options.Home), deployShell(admin), deployShell(filepath.Join(options.Output, "config.json")))
	if err = os.WriteFile(filepath.Join(options.Output, "update"), []byte(update), 0700); err != nil {
		return err
	}
	for _, name := range []string{"stdout.log", "stderr.log"} {
		if err = os.WriteFile(filepath.Join(options.Output, "logs", name), nil, 0600); err != nil {
			return err
		}
	}
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>%s</string>
<key>ProgramArguments</key><array><string>%s</string><string>--auto</string></array>
<key>WorkingDirectory</key><string>%s</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>600</integer>
<key>ExitTimeOut</key><integer>180</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>%s</string>
<key>StandardErrorPath</key><string>%s</string>
</dict></plist>
`, updaterLabel, deployXML(filepath.Join(options.Output, "update")), deployXML(options.Output), deployXML(filepath.Join(options.Output, "logs/stdout.log")), deployXML(filepath.Join(options.Output, "logs/stderr.log")))
	if err = os.WriteFile(filepath.Join(options.Output, updaterLabel+".plist"), []byte(plist), 0600); err != nil {
		return err
	}
	control := filepath.Join(options.DeploymentDirectory, "update-control")
	installer := fmt.Sprintf(`#!/bin/bash
set -euo pipefail
[ "$(/usr/bin/id -u)" = '%d' ] || { echo 'Install as the service user.' >&2; exit 1; }
control=%s
/bin/mkdir -p "$control"
/bin/chmod 700 "$control"
set -a
. %s
set +a
if [ -n "${REALTIME_HOST_UPDATE_DIRECTORY:-}" ] && [ "$REALTIME_HOST_UPDATE_DIRECTORY" != "$control" ]; then
 echo 'REALTIME_HOST_UPDATE_DIRECTORY points to another deployment.' >&2; exit 1
fi
if [ -z "${REALTIME_HOST_UPDATE_DIRECTORY:-}" ]; then
 /usr/bin/printf '\nREALTIME_HOST_UPDATE_DIRECTORY=%%s\n' %s >> %s
fi
agent=%s
/bin/mkdir -p %s
[ ! -e "$agent" ] && [ ! -L "$agent" ] || { echo 'Updater LaunchAgent already exists.' >&2; exit 1; }
/usr/bin/plutil -lint %s
/bin/cp %s "$agent"
/bin/chmod 600 "$agent"
/bin/launchctl bootstrap gui/%d "$agent"
`, os.Getuid(), deployShell(control), deployShell(deployment.EnvFile), deployShell(deployShell(control)), deployShell(deployment.EnvFile), deployShell(filepath.Join(options.Home, "Library/LaunchAgents", updaterLabel+".plist")), deployShell(filepath.Join(options.Home, "Library/LaunchAgents")), deployShell(filepath.Join(options.Output, updaterLabel+".plist")), deployShell(filepath.Join(options.Output, updaterLabel+".plist")), os.Getuid())
	return os.WriteFile(filepath.Join(options.Output, "install.sh"), []byte(installer), 0700)
}
