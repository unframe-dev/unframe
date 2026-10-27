package main

import (
	"errors"
	"net"
	"os"
	"strconv"
)

func runtimeListener(address string, getenv func(string) string) (net.Listener, error) {
	value := getenv("REALTIME_LISTEN_FD")
	if value == "" {
		return net.Listen("tcp", address)
	}
	fd, err := strconv.Atoi(value)
	if err != nil || fd < 3 {
		return nil, errors.New("invalid inherited Runtime listener")
	}
	file := os.NewFile(uintptr(fd), "runtime-listener")
	if file == nil {
		return nil, errors.New("inherited Runtime listener is unavailable")
	}
	defer func() { _ = file.Close() }()
	listener, err := net.FileListener(file)
	if err != nil {
		return nil, errors.New("inherited Runtime listener is invalid")
	}
	return listener, nil
}
