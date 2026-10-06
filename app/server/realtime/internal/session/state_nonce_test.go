package session

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

func TestStateNonceIsConnectionBoundAndSingleUse(t *testing.T) {
	clock := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	nonces := NewStateNonceManager(func() time.Time { return clock })
	nonce, err := nonces.Issue("connection-1", "participant-1")
	if err != nil || len(nonce) != 32 {
		t.Fatalf("issued nonce length = %d, error = %v", len(nonce), err)
	}
	if err := nonces.Consume("connection-2", "participant-1", nonce); !errors.Is(err, ErrStateNonceInvalid) {
		t.Fatalf("different connection error = %v", err)
	}
	if err := nonces.Consume("connection-1", "participant-2", nonce); !errors.Is(err, ErrStateNonceInvalid) {
		t.Fatalf("different participant error = %v", err)
	}
	if err := nonces.Consume("connection-1", "participant-1", nonce); err != nil {
		t.Fatalf("first consumption: %v", err)
	}
	if err := nonces.Consume("connection-1", "participant-1", nonce); !errors.Is(err, ErrStateNonceInvalid) {
		t.Fatalf("replay error = %v", err)
	}
}

func TestStateNonceExpiresAndRevocationRejectsIt(t *testing.T) {
	clock := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	nonces := NewStateNonceManager(func() time.Time { return clock })
	nonce, err := nonces.Issue("connection-1", "participant-1")
	if err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(30 * time.Second)
	if err := nonces.Consume("connection-1", "participant-1", nonce); !errors.Is(err, ErrStateNonceInvalid) {
		t.Fatalf("expired nonce error = %v", err)
	}
	nonce, err = nonces.Issue("connection-2", "participant-1")
	if err != nil {
		t.Fatal(err)
	}
	nonces.Revoke("connection-2")
	if err := nonces.Consume("connection-2", "participant-1", nonce); !errors.Is(err, ErrStateNonceInvalid) {
		t.Fatalf("revoked nonce error = %v", err)
	}
}

func TestStateNonceIssueRotatesPriorNonce(t *testing.T) {
	nonces := NewStateNonceManager(time.Now)
	first, err := nonces.Issue("connection-1", "participant-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := nonces.Issue("connection-1", "participant-1")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first, second) {
		t.Fatal("nonce reused")
	}
	if err := nonces.Consume("connection-1", "participant-1", first); !errors.Is(err, ErrStateNonceInvalid) {
		t.Fatalf("rotated nonce error = %v", err)
	}
	if err := nonces.Consume("connection-1", "participant-1", second); err != nil {
		t.Fatalf("new nonce consumption: %v", err)
	}
}
