package host

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
)

func TestMain(m *testing.M) {
	if marker := os.Getenv("UNFRAME_HOST_TEST_MARKER"); marker != "" {
		_ = os.WriteFile(marker, []byte("started"), 0600)
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func TestOccupiedHealthyPortCannotBeClaimedByAssignedChild(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	healthService := health.NewServer()
	healthService.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	grpc_health_v1.RegisterHealthServer(server, healthService)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "started")
	t.Setenv("UNFRAME_HOST_TEST_MARKER", marker)
	config := Config{Executable: executable, RuntimeID: "host-1", Endpoint: "https://runtime.test", ListenAddr: listener.Addr().String()}
	child, err := ProcessStarter(config)(*hostAssignment())
	if child != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = child.Stop(ctx)
	}
	if err == nil {
		t.Fatal("assigned child claimed a port owned by another healthy Runtime")
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("child was started before its listener could be owned")
	}
}
