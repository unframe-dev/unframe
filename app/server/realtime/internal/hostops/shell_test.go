package hostops

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func shellRepository(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func shellWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
}

// This subprocess implements the same JSON boundary used by the packaged CLI.
func TestShellAdminHelper(t *testing.T) {
	if os.Getenv("HOSTOPS_SHELL_HELPER") != "1" {
		return
	}
	data, err := io.ReadAll(os.Stdin)
	if err == nil {
		switch os.Args[len(os.Args)-1] {
		case "funnel-hostname":
			var name string
			name, err = FunnelHostname(data)
			if err == nil {
				fmt.Println(name)
			}
		case "funnel-vacant":
			err = CheckFunnelVacant(data)
		default:
			err = fmt.Errorf("unknown helper command")
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}

type shellFunnelOptions struct {
	loggedOut, existing, funnelFails, caddyFails, stop bool
	serve, caddyConfig                                 string
}

func shellFunnelFixture(t *testing.T, options shellFunnelOptions) (string, string, string, error) {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	state := "Running"
	if options.loggedOut {
		state = "NeedsLogin"
	}
	serve := options.serve
	if serve == "" {
		serve = "{}"
		if options.existing {
			serve = `{"TCP":{"443":{}}}`
		}
	}
	funnelExit := "0"
	if options.funnelFails {
		funnelExit = "1"
	}
	shellWrite(t, filepath.Join(bin, "tailscale"), fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$*" >> "$TEST_LOG"
shift
case "$*" in
  'status --json') echo '{"BackendState":"%s","Self":{"DNSName":"fixture.example.ts.net."}}';;
  'serve status --json') echo '%s';;
  'funnel --bg --tcp=443 tcp://127.0.0.1:8443') exit %s;;
esac
`, state, serve, funnelExit))
	caddyFailure := ""
	if options.caddyFails {
		caddyFailure = "echo 'listener unavailable' >&2; exit 1"
	}
	shellWrite(t, filepath.Join(bin, "caddy"), `#!/bin/sh
printf 'caddy %s\n' "$*" >> "$TEST_LOG"
if [ "$1" = validate ]; then exit 0; fi
if [ "$1" = start ]; then
  `+caddyFailure+`
  while [ "$1" != --pidfile ]; do shift; done
  shift
  "$0" daemon </dev/null >/dev/null 2>&1 &
  daemon_pid=$!
  while [ ! -e "$TEST_LOG.caddy-ready" ]; do sleep 0.01; done
  echo "$daemon_pid" > "$1"
  exit 0
fi
trap 'echo caddy-stopped >> "$TEST_LOG"; rm -f "$TEST_LOG.caddy-ready"; exit' TERM
touch "$TEST_LOG.caddy-ready"
while :; do sleep 0.1; done
`)
	stop := ""
	if options.stop {
		stop = "kill -TERM \"$PPID\"\nsleep 0.3\n"
	}
	shellWrite(t, filepath.Join(bin, "runtime-host"), `#!/bin/sh
printf '%s\n%s\n' "$REALTIME_RUNTIME_ENDPOINT" "$REALTIME_LISTEN_ADDR" >> "$TEST_LOG"
[ "$REALTIME_SERVICE_IDENTITY" = fixture-secret ] || exit 9
sleep 0.3
`+stop)
	testExe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	admin := filepath.Join(bin, "runtime-host-admin")
	shellWrite(t, admin, "#!/bin/sh\nexec '"+strings.ReplaceAll(testExe, "'", "'\\''")+"' -test.run='^TestShellAdminHelper$' -- \"$@\"\n")
	envFile := filepath.Join(dir, "runtime-host.env")
	shellWrite(t, envFile, "REALTIME_SERVICE_IDENTITY='fixture-secret'\nREALTIME_RUNTIME_ENDPOINT=https://old.example\nREALTIME_LISTEN_ADDR=0.0.0.0:9090\n")
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bash", filepath.Join(shellRepository(t), "scripts/runtime-host/funnel.sh"), bin, envFile)
	cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "TEST_LOG="+filepath.Join(dir, "calls"), "TS_SOCKET="+filepath.Join(dir, "tailscaled.sock"), "REPO_ROOT="+shellRepository(t), "RUNTIME_HOST_ADMIN="+admin, "HOSTOPS_SHELL_HELPER=1")
	if options.caddyConfig != "" {
		cmd.Env = append(cmd.Env, "CADDY_CONFIG="+options.caddyConfig)
	}
	data, runErr := cmd.CombinedOutput()
	for deadline := time.Now().Add(time.Second); time.Now().Before(deadline); {
		if _, err := os.Stat(filepath.Join(dir, "calls.caddy-ready")); os.IsNotExist(err) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	log, _ := os.ReadFile(filepath.Join(dir, "calls"))
	env, _ := os.ReadFile(envFile)
	return string(data), string(log), string(env), runErr
}

func TestFunnelShellPublishesAndCleansUpWithoutChangingPrivateEnvironment(t *testing.T) {
	output, log, env, err := shellFunnelFixture(t, shellFunnelOptions{})
	if err != nil {
		t.Fatalf("%v: %s", err, output)
	}
	for _, want := range []string{"https://fixture.example.ts.net\n127.0.0.1:9090", "funnel --bg --tcp=443 tcp://127.0.0.1:8443", "funnel --tcp=443 off", "caddy-stopped"} {
		if !strings.Contains(log, want) {
			t.Fatalf("missing %q in %s", want, log)
		}
	}
	if strings.Contains(output, "fixture-secret") || !strings.Contains(env, "https://old.example") {
		t.Fatal("private environment was exposed or changed")
	}
}

func TestFunnelShellRefusesUnreadyDaemonOrExistingListenersBeforePublishing(t *testing.T) {
	for _, options := range []shellFunnelOptions{
		{loggedOut: true}, {existing: true},
		{serve: `{"AllowFunnel":{"fixture.example.ts.net:443":true},"Web":{"fixture.example.ts.net:443":{"Handlers":{}}}}`},
		{serve: `{"Foreground":{"active":{}}}`},
		{caddyFails: true},
	} {
		output, log, _, err := shellFunnelFixture(t, options)
		if err == nil || strings.Contains(log, "funnel --") {
			t.Fatalf("unexpected publication: %v, %s, %s", err, output, log)
		}
	}
}

func TestFunnelShellCleansUpFailedPublicationAndTermination(t *testing.T) {
	for _, options := range []shellFunnelOptions{{funnelFails: true}, {stop: true}} {
		output, log, _, err := shellFunnelFixture(t, options)
		if err == nil || !strings.Contains(log, "funnel --tcp=443 off") || !strings.Contains(log, "caddy-stopped") {
			t.Fatalf("cleanup failed: %v, %s, %s", err, output, log)
		}
	}
}

func TestFunnelShellAllowsRetainedPermissionAndPackagedConfiguration(t *testing.T) {
	output, log, _, err := shellFunnelFixture(t, shellFunnelOptions{serve: `{"AllowFunnel":{"fixture.example.ts.net:443":true}}`, caddyConfig: "/packaged/funnel/Caddyfile"})
	if err != nil || !strings.Contains(log, "caddy validate --config /packaged/funnel/Caddyfile --adapter caddyfile") {
		t.Fatalf("packaged restart failed: %v, %s, %s", err, output, log)
	}
}

func TestDeployShellPreparesReleaseAndRemovesFailedStaging(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("deployment script uses macOS plutil and service accounts")
	}
	account, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	if account.Uid == "0" {
		t.Skip("requires a non-root service account")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	goTool := filepath.Join(bin, "go")
	shellWrite(t, goTool, "#!/bin/sh\nwhile [ \"$1\" != -o ]; do shift; done\nshift\nprintf '#!/bin/sh\\nexit 0\\n' > \"$1\"\nchmod +x \"$1\"\n")
	output := filepath.Join(dir, "release with spaces")
	invoke := func(path, serviceUser string) error {
		cmd := exec.Command("bash", filepath.Join(shellRepository(t), "scripts/runtime-host/deploy.sh"), path, serviceUser)
		cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "REPO_ROOT="+shellRepository(t))
		return cmd.Run()
	}
	if err := invoke(output, account.Username); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"runtime-host", "start.sh", "runtime-host.env.example", "me.un-fra.realtime.plist"} {
		if _, err := os.Stat(filepath.Join(output, name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := invoke(output, account.Username); err == nil {
		t.Fatal("overwrote an existing release")
	}
	shellWrite(t, goTool, "#!/bin/sh\nexit 1\n")
	if err := invoke(filepath.Join(dir, "failed"), account.Username); err == nil {
		t.Fatal("ignored build failure")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 2 {
		t.Fatalf("partial release remains: %v, %v", entries, err)
	}
	for _, name := range []string{"root", "unframe_nonexistent_test_user"} {
		if err := invoke(filepath.Join(dir, "refused"), name); err == nil {
			t.Fatalf("accepted service user %s", name)
		}
	}
}
