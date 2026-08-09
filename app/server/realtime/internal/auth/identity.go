package auth

import (
	"context"
	"errors"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

var ErrUnauthenticated = errors.New("realtime connection identity is unavailable")

// IdentityResolver obtains claims verified at the connection boundary.
type IdentityResolver interface {
	Resolve(context.Context) (session.Identity, error)
}

type ContextIdentityResolver struct{}

func (ContextIdentityResolver) Resolve(ctx context.Context) (session.Identity, error) {
	identity, ok := ctx.Value(identityContextKey{}).(session.Identity)
	if !ok {
		return session.Identity{}, ErrUnauthenticated
	}
	return identity, nil
}

// ContextWithIdentity is for a verified authentication adapter to bind claims
// to a stream context. It deliberately has no wire representation.
func ContextWithIdentity(ctx context.Context, identity session.Identity) context.Context {
	return context.WithValue(ctx, identityContextKey{}, identity)
}

type identityContextKey struct{}
