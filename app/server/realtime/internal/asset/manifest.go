package asset

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
)

var (
	ErrInvalidManifest = errors.New("asset manifest is invalid")
	sha256Pattern      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	identifierPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

type Manifest struct {
	PresentationID       string
	PresentationRevision uint64
	DefinitionChecksum   string
	ProtocolVersion      string
	Assets               []Descriptor
}

type Descriptor struct {
	ID        string
	SHA256    string
	Size      int64
	MediaType string
	SourceURL string
}

func (m Manifest) Validate() error {
	if !identifierPattern.MatchString(m.PresentationID) {
		return fmt.Errorf("%w: presentation ID", ErrInvalidManifest)
	}
	if m.PresentationRevision == 0 {
		return fmt.Errorf("%w: presentation revision", ErrInvalidManifest)
	}
	if !sha256Pattern.MatchString(m.DefinitionChecksum) {
		return fmt.Errorf("%w: definition checksum", ErrInvalidManifest)
	}
	if m.ProtocolVersion == "" {
		return fmt.Errorf("%w: protocol version", ErrInvalidManifest)
	}
	seen := make(map[string]struct{}, len(m.Assets))
	for _, descriptor := range m.Assets {
		if err := descriptor.validate(); err != nil {
			return err
		}
		if _, duplicate := seen[descriptor.ID]; duplicate {
			return fmt.Errorf("%w: duplicate asset ID %q", ErrInvalidManifest, descriptor.ID)
		}
		seen[descriptor.ID] = struct{}{}
	}
	return nil
}

func (d Descriptor) validate() error {
	if !identifierPattern.MatchString(d.ID) {
		return fmt.Errorf("%w: asset ID", ErrInvalidManifest)
	}
	if !sha256Pattern.MatchString(d.SHA256) {
		return fmt.Errorf("%w: asset checksum", ErrInvalidManifest)
	}
	if d.Size < 0 {
		return fmt.Errorf("%w: asset size", ErrInvalidManifest)
	}
	if d.MediaType == "" {
		return fmt.Errorf("%w: asset media type", ErrInvalidManifest)
	}
	parsed, err := url.ParseRequestURI(d.SourceURL)
	if err != nil || parsed.Host == "" || parsed.Scheme != "https" {
		return fmt.Errorf("%w: asset source URL", ErrInvalidManifest)
	}
	return nil
}
