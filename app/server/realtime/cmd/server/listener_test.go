package main

import (
	"net"
	"strconv"
	"syscall"
	"testing"
)

func TestRuntimeListenerOwnsInheritedSocketWithoutBindingAgain(t *testing.T) {
	original, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = original.Close() }()
	file, err := original.(*net.TCPListener).File()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	fd, err := syscall.Dup(int(file.Fd()))
	if err != nil {
		t.Fatal(err)
	}
	inherited, err := runtimeListener("invalid-fallback-address", func(string) string { return strconv.Itoa(fd) })
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = inherited.Close() }()
	if inherited.Addr().String() != original.Addr().String() {
		t.Fatal("Runtime did not adopt the Host-owned listener")
	}
}
func TestInvalidInheritedListenerDoesNotFallBackToBinding(t *testing.T) {
	for _, value := range []string{"2", "-1", "not-a-descriptor", "999999"} {
		listener, err := runtimeListener("127.0.0.1:0", func(string) string { return value })
		if listener != nil {
			_ = listener.Close()
		}
		if err == nil {
			t.Errorf("accepted invalid inherited descriptor %q", value)
		}
	}
}
