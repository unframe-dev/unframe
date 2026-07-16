package service

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/unframe-dev/unframe/apps/backend/internal/storage"
)

type ManifestAsset struct {
	AssetID   string `json:"assetId" format:"uuid"`
	URL       string `json:"url" format:"uri"`
	Filename  string `json:"filename"`
	MimeType  string `json:"mimeType"`
	SizeBytes int64  `json:"sizeBytes" minimum:"0"`
}

type ManifestTextElement struct {
	Type      string    `json:"type" enum:"text"`
	ID        string    `json:"id" format:"uuid"`
	Transform Transform `json:"transform"`
	Text      string    `json:"text"`
}

type ManifestModelElement struct {
	Type      string        `json:"type" enum:"model"`
	ID        string        `json:"id" format:"uuid"`
	Transform Transform     `json:"transform"`
	Asset     ManifestAsset `json:"asset"`
}

type ManifestImageElement struct {
	Type      string        `json:"type" enum:"image"`
	ID        string        `json:"id" format:"uuid"`
	Transform Transform     `json:"transform"`
	Asset     ManifestAsset `json:"asset"`
}

type ManifestShapeElement struct {
	Type        string    `json:"type" enum:"shape"`
	ID          string    `json:"id" format:"uuid"`
	Transform   Transform `json:"transform"`
	Shape       string    `json:"shape" enum:"rectangle,ellipse"`
	FillColor   string    `json:"fillColor"`
	StrokeColor string    `json:"strokeColor"`
	StrokeWidth float64   `json:"strokeWidth"`
}

type ManifestElement struct {
	Type        string         `json:"type"`
	ID          string         `json:"id"`
	Transform   Transform      `json:"transform"`
	Text        *string        `json:"text,omitempty"`
	Asset       *ManifestAsset `json:"asset,omitempty"`
	Shape       *string        `json:"shape,omitempty"`
	FillColor   *string        `json:"fillColor,omitempty"`
	StrokeColor *string        `json:"strokeColor,omitempty"`
	StrokeWidth *float64       `json:"strokeWidth,omitempty"`
}

func (ManifestElement) Schema(registry huma.Registry) *huma.Schema {
	return unionSchema(registry, []unionVariant{
		{"text", reflect.TypeFor[ManifestTextElement](), "ManifestTextElement"},
		{"model", reflect.TypeFor[ManifestModelElement](), "ManifestModelElement"},
		{"image", reflect.TypeFor[ManifestImageElement](), "ManifestImageElement"},
		{"shape", reflect.TypeFor[ManifestShapeElement](), "ManifestShapeElement"},
	})
}

type ManifestSlide struct {
	ID         string            `json:"id" format:"uuid"`
	OrderIndex int               `json:"orderIndex" minimum:"0"`
	Elements   []ManifestElement `json:"elements" nullable:"false"`
}

type Manifest struct {
	PresentationID string          `json:"presentationId" format:"uuid"`
	Title          string          `json:"title"`
	Slides         []ManifestSlide `json:"slides" nullable:"false"`
	UpdatedAt      time.Time       `json:"updatedAt" format:"date-time"`
}

func (presentations *Presentations) Manifest(ctx context.Context, id string) (Manifest, error) {
	record, err := presentations.repository.GetPresentation(ctx, id)
	if err != nil {
		return Manifest{}, presentations.lookupError(id, err)
	}
	updatedAt, err := parseTime(record.UpdatedAt)
	if err != nil {
		return Manifest{}, err
	}
	slideRecords, err := presentations.repository.ListSlides(ctx, id)
	if err != nil {
		return Manifest{}, fmt.Errorf("list manifest slides: %w", err)
	}
	manifest := Manifest{
		PresentationID: record.ID,
		Title:          record.Title,
		Slides:         make([]ManifestSlide, 0, len(slideRecords)),
		UpdatedAt:      updatedAt,
	}
	type decodedSlide struct {
		record  SlideRecord
		content StoredSlideContent
	}
	decoded := make([]decodedSlide, 0, len(slideRecords))
	assetIDs := map[string]struct{}{}
	for _, slideRecord := range slideRecords {
		slideUpdatedAt, parseErr := parseTime(slideRecord.UpdatedAt)
		if parseErr != nil {
			return Manifest{}, parseErr
		}
		if slideUpdatedAt.After(manifest.UpdatedAt) {
			manifest.UpdatedAt = slideUpdatedAt
		}
		var content StoredSlideContent
		if err := json.Unmarshal([]byte(slideRecord.Content), &content); err != nil {
			return Manifest{}, fmt.Errorf("decode slide %s content: %w", slideRecord.ID, err)
		}
		for _, element := range content.Elements {
			if element.Type == "image" || element.Type == "model" {
				assetIDs[element.AssetID] = struct{}{}
			}
		}
		decoded = append(decoded, decodedSlide{record: slideRecord, content: content})
	}
	assetRecords, err := presentations.repository.GetAssets(ctx, sortedIDs(assetIDs))
	if err != nil {
		return Manifest{}, fmt.Errorf("load manifest assets: %w", err)
	}
	assets := make(map[string]ManifestAsset, len(assetRecords))
	for _, assetRecord := range assetRecords {
		if presentations.storage == nil {
			return Manifest{}, fmt.Errorf("presentation storage is not configured")
		}
		signed, signErr := presentations.storage.PresignGet(ctx, storage.GetRequest{Key: assetRecord.StorageKey, Expires: presentations.urlExpiry})
		if signErr != nil {
			return Manifest{}, fmt.Errorf("presign manifest asset %s: %w", assetRecord.ID, signErr)
		}
		assets[assetRecord.ID] = ManifestAsset{AssetID: assetRecord.ID, URL: signed.URL, Filename: assetRecord.Filename, MimeType: assetRecord.MimeType, SizeBytes: assetRecord.SizeBytes}
	}
	for id := range assetIDs {
		if _, ok := assets[id]; !ok {
			return Manifest{}, fmt.Errorf("asset %s referenced by presentation %s no longer exists", id, record.ID)
		}
	}
	for _, decodedSlide := range decoded {
		slideRecord, content := decodedSlide.record, decodedSlide.content
		slide := ManifestSlide{ID: slideRecord.ID, OrderIndex: int(slideRecord.OrderIndex), Elements: make([]ManifestElement, 0, len(content.Elements))}
		for _, element := range content.Elements {
			manifestElement := ManifestElement{Type: element.Type, ID: element.ID, Transform: element.Transform}
			switch element.Type {
			case "text":
				text := element.Text
				manifestElement.Text = &text
			case "shape":
				shape, fillColor, strokeColor, strokeWidth := element.Shape, element.FillColor, element.StrokeColor, element.StrokeWidth
				manifestElement.Shape = &shape
				manifestElement.FillColor = &fillColor
				manifestElement.StrokeColor = &strokeColor
				manifestElement.StrokeWidth = &strokeWidth
			case "image", "model":
				asset := assets[element.AssetID]
				manifestElement.Asset = &asset
			default:
				return Manifest{}, fmt.Errorf("unsupported element type %q in slide %s", element.Type, slideRecord.ID)
			}
			slide.Elements = append(slide.Elements, manifestElement)
		}
		manifest.Slides = append(manifest.Slides, slide)
	}
	return manifest, nil
}
