package host

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHeartbeatUsesServiceIdentityAndRejectsInvalidResponses(t *testing.T) {
	for _, scenario := range []struct {
		name, body string
		status     int
		terminal   bool
		wantError  bool
	}{
		{"idle", `{"assignment":null}`, 200, false, false},
		{"missing", `{}`, 200, true, true},
		{"trailing", `{"assignment":null}{}`, 200, true, true},
		{"wrong type", `{"assignment":false}`, 200, true, true},
		{"revoked", `secret`, 401, true, true},
		{"offline", `secret`, 503, false, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer private-service" || r.URL.Path != "/internal/runtime/hosts/host-1/heartbeat" || r.Method != "POST" {
					t.Error("heartbeat crossed the wrong authentication boundary")
				}
				w.WriteHeader(scenario.status)
				_, _ = w.Write([]byte(scenario.body))
			}))
			defer server.Close()
			client := HTTPControlPlane{Origin: server.URL, RuntimeID: "host-1", ServiceIdentity: "private-service", Client: server.Client()}
			_, err := client.Heartbeat(context.Background(), Heartbeat{Endpoint: "https://runtime.test", Accepting: true})
			if (err != nil) != scenario.wantError {
				t.Fatalf("error=%v", err)
			}
			var terminal *TerminalError
			if errors.As(err, &terminal) != scenario.terminal {
				t.Fatalf("terminal classification=%v", err)
			}
		})
	}
}
