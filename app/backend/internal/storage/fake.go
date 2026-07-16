package storage

import (
	"context"
	"fmt"
	"net/url"
	"time"
)

type Fake struct {
	PutURL string
	GetURL string
	Now    func() time.Time
	Err    error

	PutRequests []PutRequest
	GetRequests []GetRequest
}

func (fake *Fake) PresignPut(_ context.Context, request PutRequest) (SignedURL, error) {
	fake.PutRequests = append(fake.PutRequests, request)
	if fake.Err != nil {
		return SignedURL{}, fake.Err
	}
	return SignedURL{
		URL:       fake.url(fake.PutURL, request.Key),
		ExpiresAt: fake.now().Add(request.Expires),
	}, nil
}

func (fake *Fake) PresignGet(_ context.Context, request GetRequest) (SignedURL, error) {
	fake.GetRequests = append(fake.GetRequests, request)
	if fake.Err != nil {
		return SignedURL{}, fake.Err
	}
	return SignedURL{
		URL:       fake.url(fake.GetURL, request.Key),
		ExpiresAt: fake.now().Add(request.Expires),
	}, nil
}

func (fake *Fake) now() time.Time {
	if fake.Now != nil {
		return fake.Now()
	}
	return time.Now().UTC()
}

func (fake *Fake) url(configured, key string) string {
	if configured != "" {
		return configured
	}
	return fmt.Sprintf("https://storage.example.test/%s", url.PathEscape(key))
}
