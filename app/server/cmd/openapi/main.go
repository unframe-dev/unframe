package main

import (
	"fmt"
	"os"

	"github.com/unframe-dev/unframe/app/server/internal/api"
)

func main() {
	document, err := generate()
	if err != nil {
		fmt.Fprintf(os.Stderr, "generate OpenAPI: %v\n", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(document); err != nil {
		fmt.Fprintf(os.Stderr, "write OpenAPI: %v\n", err)
		os.Exit(1)
	}
}

func generate() ([]byte, error) {
	app := api.New(api.Options{})
	return app.API.OpenAPI().YAML()
}
