package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckpointRequiresCompleteAppliedResult(t *testing.T) {
	for _, body := range []string{`{}`, `{"applied":true} garbage`, `{"applied":false}{}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer server.Close()
			client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
			if _, err := client.CheckpointEnvelope(context.Background(), callbackEnvelope(t), 4); err == nil {
				t.Fatal("malformed applied result must not acknowledge a checkpoint")
			}
		})
	}
}
