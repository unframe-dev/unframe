package main

import (
	"context"
	"sync"
	"time"
)

func newShutdownBudget() (func() context.Context, func()) {
	var once sync.Once
	var shutdown context.Context
	var cancel context.CancelFunc
	get := func() context.Context {
		once.Do(func() { shutdown, cancel = context.WithTimeout(context.Background(), 10*time.Second) })
		return shutdown
	}
	return get, func() {
		if cancel != nil {
			cancel()
		}
	}
}
