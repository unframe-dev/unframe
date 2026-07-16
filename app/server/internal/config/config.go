package config

import (
	"fmt"
	"os"
	"strings"
)

var defaultCORSOrigins = []string{"http://localhost:5173", "http://localhost:3000"}

type Config struct {
	TursoDatabaseURL string
	TursoAuthToken   string
	R2Endpoint       string
	R2AccessKeyID    string
	R2SecretKey      string
	R2Bucket         string
	CORSOrigins      []string
}

func FromEnv() (Config, error) {
	return Load(os.Getenv)
}

func Load(lookup func(string) string) (Config, error) {
	configuration := Config{
		TursoDatabaseURL: strings.TrimSpace(lookup("TURSO_DATABASE_URL")),
		TursoAuthToken:   strings.TrimSpace(lookup("TURSO_AUTH_TOKEN")),
		R2Endpoint:       strings.TrimSpace(lookup("R2_ENDPOINT")),
		R2AccessKeyID:    strings.TrimSpace(lookup("R2_ACCESS_KEY_ID")),
		R2SecretKey:      strings.TrimSpace(lookup("R2_SECRET_ACCESS_KEY")),
		R2Bucket:         strings.TrimSpace(lookup("R2_BUCKET")),
	}
	required := map[string]string{
		"TURSO_DATABASE_URL":   configuration.TursoDatabaseURL,
		"TURSO_AUTH_TOKEN":     configuration.TursoAuthToken,
		"R2_ENDPOINT":          configuration.R2Endpoint,
		"R2_ACCESS_KEY_ID":     configuration.R2AccessKeyID,
		"R2_SECRET_ACCESS_KEY": configuration.R2SecretKey,
		"R2_BUCKET":            configuration.R2Bucket,
	}
	for name, value := range required {
		if value == "" {
			return Config{}, fmt.Errorf("%s is required", name)
		}
	}

	rawOrigins := strings.TrimSpace(lookup("CORS_ORIGINS"))
	if rawOrigins == "" {
		configuration.CORSOrigins = append([]string(nil), defaultCORSOrigins...)
		return configuration, nil
	}
	for _, origin := range strings.Split(rawOrigins, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			configuration.CORSOrigins = append(configuration.CORSOrigins, trimmed)
		}
	}
	if len(configuration.CORSOrigins) == 0 {
		return Config{}, fmt.Errorf("CORS_ORIGINS must contain at least one origin")
	}
	return configuration, nil
}
