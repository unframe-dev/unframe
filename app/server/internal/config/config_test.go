package config

import "testing"

func TestLoadUsesDefaultCORSOrigins(t *testing.T) {
	values := map[string]string{
		"TURSO_DATABASE_URL":   "libsql://example.turso.io",
		"TURSO_AUTH_TOKEN":     "database-token",
		"R2_ENDPOINT":          "https://account.r2.cloudflarestorage.com",
		"R2_ACCESS_KEY_ID":     "access-key",
		"R2_SECRET_ACCESS_KEY": "secret-key",
		"R2_BUCKET":            "assets",
	}

	configuration, err := Load(func(key string) string { return values[key] })
	if err != nil {
		t.Fatal(err)
	}
	if len(configuration.CORSOrigins) != 2 || configuration.CORSOrigins[0] != "http://localhost:5173" || configuration.CORSOrigins[1] != "http://localhost:3000" {
		t.Fatalf("CORS origins = %#v", configuration.CORSOrigins)
	}
}

func TestLoadParsesConfiguredCORSOrigins(t *testing.T) {
	values := map[string]string{
		"TURSO_DATABASE_URL":   "libsql://example.turso.io",
		"TURSO_AUTH_TOKEN":     "database-token",
		"R2_ENDPOINT":          "https://account.r2.cloudflarestorage.com",
		"R2_ACCESS_KEY_ID":     "access-key",
		"R2_SECRET_ACCESS_KEY": "secret-key",
		"R2_BUCKET":            "assets",
		"CORS_ORIGINS":         "https://app.example.com, http://localhost:5173 ",
	}

	configuration, err := Load(func(key string) string { return values[key] })
	if err != nil {
		t.Fatal(err)
	}
	if len(configuration.CORSOrigins) != 2 || configuration.CORSOrigins[0] != "https://app.example.com" || configuration.CORSOrigins[1] != "http://localhost:5173" {
		t.Fatalf("CORS origins = %#v", configuration.CORSOrigins)
	}
}

func TestLoadRejectsMissingRequiredEnvironment(t *testing.T) {
	if _, err := Load(func(string) string { return "" }); err == nil {
		t.Fatal("expected missing environment to fail")
	}
}
