package storage

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type R2Config struct {
	Endpoint        string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	Now             func() time.Time
}

type R2 struct {
	bucket    string
	presigner *s3.PresignClient
	now       func() time.Time
}

func NewR2(config R2Config) (*R2, error) {
	if config.Endpoint == "" || config.AccessKeyID == "" || config.SecretAccessKey == "" || config.Bucket == "" {
		return nil, errors.New("R2 endpoint, credentials, and bucket are required")
	}
	endpoint, err := url.Parse(config.Endpoint)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("invalid R2 endpoint %q", config.Endpoint)
	}

	client := s3.NewFromConfig(aws.Config{
		Region:      "auto",
		Credentials: credentials.NewStaticCredentialsProvider(config.AccessKeyID, config.SecretAccessKey, ""),
	}, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(strings.TrimRight(config.Endpoint, "/"))
		options.UsePathStyle = true
	})
	now := config.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &R2{
		bucket:    config.Bucket,
		presigner: s3.NewPresignClient(client),
		now:       now,
	}, nil
}

func (r2 *R2) PresignPut(ctx context.Context, request PutRequest) (SignedURL, error) {
	if request.Key == "" || request.ContentType == "" || request.SizeBytes <= 0 || request.Expires <= 0 {
		return SignedURL{}, errors.New("key, content type, content length, and positive expiry are required")
	}
	presigned, err := r2.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(r2.bucket),
		Key:           aws.String(request.Key),
		ContentType:   aws.String(request.ContentType),
		ContentLength: aws.Int64(request.SizeBytes),
	}, s3.WithPresignExpires(request.Expires))
	if err != nil {
		return SignedURL{}, fmt.Errorf("presign R2 put: %w", err)
	}
	return SignedURL{URL: presigned.URL, ExpiresAt: r2.now().Add(request.Expires)}, nil
}

func (r2 *R2) PresignGet(ctx context.Context, request GetRequest) (SignedURL, error) {
	if request.Key == "" || request.Expires <= 0 {
		return SignedURL{}, errors.New("key and positive expiry are required")
	}
	presigned, err := r2.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r2.bucket),
		Key:    aws.String(request.Key),
	}, s3.WithPresignExpires(request.Expires))
	if err != nil {
		return SignedURL{}, fmt.Errorf("presign R2 get: %w", err)
	}
	return SignedURL{URL: presigned.URL, ExpiresAt: r2.now().Add(request.Expires)}, nil
}

var _ Storage = (*R2)(nil)
