package api

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func assertJSON(t *testing.T, data []byte, want map[string]any) {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("decode response: %v; body = %s", err, data)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("response = %#v, want %#v", got, want)
	}
}

func assertError(t *testing.T, response *httptest.ResponseRecorder, status int, code, message string, wantDetails bool) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
	var got struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Details any    `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v; body = %s", err, response.Body.String())
	}
	if got.Error.Code != code || got.Error.Message != message {
		t.Fatalf("error = %#v, want code=%q message=%q", got.Error, code, message)
	}
	if wantDetails && got.Error.Details == nil {
		t.Fatal("expected validation details")
	}
	if !wantDetails && got.Error.Details != nil {
		t.Fatalf("unexpected error details: %#v", got.Error.Details)
	}
}

func contains(value, substring string) bool {
	return strings.Contains(value, substring)
}
