package main

import (
	"context"
	"net"
	"testing"
)

func TestRunReturnsServeFailure(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	if err := run(context.Background(), listener); err == nil {
		t.Fatal("run() error = nil, want Serve failure")
	}
}
