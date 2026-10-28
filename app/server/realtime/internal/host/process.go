package host

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health/grpc_health_v1"
)

type process struct {
	cmd        *exec.Cmd
	done       chan struct{}
	connection *grpc.ClientConn
}

func ProcessStarter(config Config) func(Assignment) (Child, error) {
	return func(assignment Assignment) (Child, error) {
		if err := assignment.validate(config.RuntimeID, config.Endpoint); err != nil {
			return nil, err
		}
		listener, err := net.Listen("tcp", config.ListenAddr)
		if err != nil {
			return nil, err
		}
		file, err := listener.(*net.TCPListener).File()
		_ = listener.Close()
		if err != nil {
			return nil, err
		}
		defer func() { _ = file.Close() }()
		host, port, _ := net.SplitHostPort(config.ListenAddr)
		if host == "" || host == "0.0.0.0" {
			host = "127.0.0.1"
		}
		if host == "::" {
			host = "::1"
		}
		connection, err := grpc.NewClient(net.JoinHostPort(host, port), grpc.WithTransportCredentials(insecure.NewCredentials()))
		if err != nil {
			return nil, err
		}
		cmd := exec.Command(config.Executable)
		cmd.Env = append(config.Environment(assignment), "REALTIME_LISTEN_FD=3")
		cmd.ExtraFiles = []*os.File{file}
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		if err := cmd.Start(); err != nil {
			_ = connection.Close()
			return nil, err
		}
		p := &process{cmd: cmd, done: make(chan struct{}), connection: connection}
		go func() { _ = cmd.Wait(); close(p.done) }()
		return p, nil
	}
}
func (p *process) Done() <-chan struct{} { return p.done }
func (p *process) Serving(ctx context.Context) bool {
	select {
	case <-p.done:
		return false
	default:
	}
	response, err := grpc_health_v1.NewHealthClient(p.connection).Check(ctx, &grpc_health_v1.HealthCheckRequest{})
	return err == nil && response.Status == grpc_health_v1.HealthCheckResponse_SERVING
}
func (p *process) Stop(ctx context.Context) error {
	defer func() { _ = p.connection.Close() }()
	signal := func(value syscall.Signal) error {
		err := syscall.Kill(-p.cmd.Process.Pid, value)
		if errors.Is(err, syscall.ESRCH) {
			return nil
		}
		return err
	}
	if err := signal(syscall.SIGTERM); err != nil {
		return err
	}
	select {
	case <-p.done:
		return signal(syscall.SIGKILL)
	case <-ctx.Done():
		if err := signal(syscall.SIGKILL); err != nil {
			return err
		}
		select {
		case <-p.done:
			return nil
		case <-time.After(time.Second):
			return errors.New("runtime child did not exit after forced shutdown")
		}
	}
}
