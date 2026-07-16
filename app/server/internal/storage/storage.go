package storage

import (
	"context"
	"time"
)

type PutRequest struct {
	Key         string
	ContentType string
	SizeBytes   int64
	Expires     time.Duration
}

type GetRequest struct {
	Key     string
	Expires time.Duration
}

type SignedURL struct {
	URL       string
	ExpiresAt time.Time
}

type Storage interface {
	PresignPut(context.Context, PutRequest) (SignedURL, error)
	PresignGet(context.Context, GetRequest) (SignedURL, error)
}
