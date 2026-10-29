package host

import "testing"

func TestHostConfigRequiresCapacityAndHTTPSIdentity(t *testing.T) {
	values := map[string]string{"REALTIME_HOST_CAPACITY": "8", "REALTIME_CONTROL_PLANE_URL": "https://cp.test", "REALTIME_SERVICE_IDENTITY": "01234567890123456789012345678901", "REALTIME_RUNTIME_ID": "host-1", "REALTIME_RUNTIME_ENDPOINT": "https://runtime.test", "REALTIME_LISTEN_ADDR": "127.0.0.1:9090", "REALTIME_ISSUER": "https://cp.test", "REALTIME_AUDIENCE": "unframe-realtime-runtime", "REALTIME_JWKS_URL": "https://cp.test/.well-known/jwks.json"}
	read := func(name string) string { return values[name] }
	if c, err := LoadConfig(read); err != nil || c.Capacity != 8 {
		t.Fatalf("config=%+v err=%v", c, err)
	}
	for key, invalid := range map[string]string{"REALTIME_HOST_CAPACITY": "0", "REALTIME_CONTROL_PLANE_URL": "http://cp.test", "REALTIME_RUNTIME_ENDPOINT": "https://runtime.test/prefix", "REALTIME_RUNTIME_ID": "host/other", "REALTIME_SERVICE_IDENTITY": "short", "REALTIME_LISTEN_ADDR": "invalid", "REALTIME_JWKS_URL": "https://user:secret@cp.test/key", "REALTIME_HOST_DRAIN": "maybe"} {
		old := values[key]
		values[key] = invalid
		if _, err := LoadConfig(read); err == nil {
			t.Errorf("accepted invalid %s", key)
		}
		values[key] = old
	}
}
