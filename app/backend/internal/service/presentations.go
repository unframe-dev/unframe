package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/unframe-dev/unframe/apps/backend/internal/storage"
)

type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type Transform struct {
	Position Vec3 `json:"position"`
	Rotation Vec3 `json:"rotation"`
	Scale    Vec3 `json:"scale"`
}

type TextElement struct {
	ID         string    `json:"id" format:"uuid"`
	Type       string    `json:"type" enum:"text"`
	Transform  Transform `json:"transform"`
	Text       string    `json:"text"`
	FontSize   float64   `json:"fontSize" exclusiveMinimum:"0"`
	FontColor  string    `json:"fontColor" minLength:"1"`
	FontFamily string    `json:"fontFamily" minLength:"1"`
	FontWeight string    `json:"fontWeight" enum:"normal,bold"`
	TextAlign  string    `json:"textAlign" enum:"left,center,right"`
}

type StoredModelElement struct {
	ID          string    `json:"id" format:"uuid"`
	Type        string    `json:"type" enum:"model"`
	Transform   Transform `json:"transform"`
	AssetID     string    `json:"assetId" format:"uuid"`
	DisplayName string    `json:"displayName"`
}

type ModelElement struct {
	ID          string    `json:"id" format:"uuid"`
	Type        string    `json:"type" enum:"model"`
	Transform   Transform `json:"transform"`
	AssetID     string    `json:"assetId" format:"uuid"`
	DisplayName string    `json:"displayName"`
	Src         string    `json:"src" format:"uri"`
}

type StoredImageElement struct {
	ID        string    `json:"id" format:"uuid"`
	Type      string    `json:"type" enum:"image"`
	Transform Transform `json:"transform"`
	AssetID   string    `json:"assetId" format:"uuid"`
	Alt       *string   `json:"alt,omitempty"`
}

type ImageElement struct {
	ID        string    `json:"id" format:"uuid"`
	Type      string    `json:"type" enum:"image"`
	Transform Transform `json:"transform"`
	AssetID   string    `json:"assetId" format:"uuid"`
	Alt       *string   `json:"alt,omitempty"`
	Src       string    `json:"src" format:"uri"`
}

type ShapeElement struct {
	ID          string    `json:"id" format:"uuid"`
	Type        string    `json:"type" enum:"shape"`
	Transform   Transform `json:"transform"`
	Shape       string    `json:"shape" enum:"rectangle,ellipse"`
	FillColor   string    `json:"fillColor" minLength:"1"`
	StrokeColor string    `json:"strokeColor" minLength:"1"`
	StrokeWidth float64   `json:"strokeWidth" minimum:"0"`
}

// StoredSlideElement is the write/persistence union. It deliberately has no src field.
type StoredSlideElement struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Transform   Transform `json:"transform"`
	Text        string    `json:"text,omitempty"`
	FontSize    float64   `json:"fontSize,omitempty"`
	FontColor   string    `json:"fontColor,omitempty"`
	FontFamily  string    `json:"fontFamily,omitempty"`
	FontWeight  string    `json:"fontWeight,omitempty"`
	TextAlign   string    `json:"textAlign,omitempty"`
	AssetID     string    `json:"assetId,omitempty"`
	DisplayName string    `json:"displayName,omitempty"`
	Alt         *string   `json:"alt,omitempty"`
	Shape       string    `json:"shape,omitempty"`
	FillColor   string    `json:"fillColor,omitempty"`
	StrokeColor string    `json:"strokeColor,omitempty"`
	StrokeWidth float64   `json:"strokeWidth,omitempty"`
}

func (element StoredSlideElement) MarshalJSON() ([]byte, error) {
	switch element.Type {
	case "text":
		return json.Marshal(TextElement{
			ID: element.ID, Type: element.Type, Transform: element.Transform, Text: element.Text,
			FontSize: element.FontSize, FontColor: element.FontColor, FontFamily: element.FontFamily,
			FontWeight: element.FontWeight, TextAlign: element.TextAlign,
		})
	case "model":
		return json.Marshal(StoredModelElement{
			ID: element.ID, Type: element.Type, Transform: element.Transform,
			AssetID: element.AssetID, DisplayName: element.DisplayName,
		})
	case "image":
		return json.Marshal(StoredImageElement{
			ID: element.ID, Type: element.Type, Transform: element.Transform,
			AssetID: element.AssetID, Alt: element.Alt,
		})
	case "shape":
		return json.Marshal(ShapeElement{
			ID: element.ID, Type: element.Type, Transform: element.Transform, Shape: element.Shape,
			FillColor: element.FillColor, StrokeColor: element.StrokeColor, StrokeWidth: element.StrokeWidth,
		})
	default:
		type rawElement StoredSlideElement
		return json.Marshal(rawElement(element))
	}
}

func (StoredSlideElement) Schema(registry huma.Registry) *huma.Schema {
	return unionSchema(registry, []unionVariant{
		{"text", reflect.TypeFor[TextElement](), "TextElement"},
		{"model", reflect.TypeFor[StoredModelElement](), "StoredModelElement"},
		{"image", reflect.TypeFor[StoredImageElement](), "StoredImageElement"},
		{"shape", reflect.TypeFor[ShapeElement](), "ShapeElement"},
	})
}

type SlideElement struct {
	StoredSlideElement
	Src string `json:"src,omitempty"`
}

func (element SlideElement) MarshalJSON() ([]byte, error) {
	stored := element.StoredSlideElement
	switch stored.Type {
	case "text", "shape":
		return stored.MarshalJSON()
	case "model":
		return json.Marshal(ModelElement{
			ID: stored.ID, Type: stored.Type, Transform: stored.Transform, AssetID: stored.AssetID,
			DisplayName: stored.DisplayName, Src: element.Src,
		})
	case "image":
		return json.Marshal(ImageElement{
			ID: stored.ID, Type: stored.Type, Transform: stored.Transform, AssetID: stored.AssetID,
			Alt: stored.Alt, Src: element.Src,
		})
	default:
		type rawElement SlideElement
		return json.Marshal(rawElement(element))
	}
}

func (SlideElement) Schema(registry huma.Registry) *huma.Schema {
	return unionSchema(registry, []unionVariant{
		{"text", reflect.TypeFor[TextElement](), "TextElement"},
		{"model", reflect.TypeFor[ModelElement](), "ModelElement"},
		{"image", reflect.TypeFor[ImageElement](), "ImageElement"},
		{"shape", reflect.TypeFor[ShapeElement](), "ShapeElement"},
	})
}

type unionVariant struct {
	kind   string
	typeOf reflect.Type
	hint   string
}

func unionSchema(registry huma.Registry, variants []unionVariant) *huma.Schema {
	oneOf := make([]*huma.Schema, 0, len(variants))
	mapping := make(map[string]string, len(variants))
	for _, variant := range variants {
		schema := registry.Schema(variant.typeOf, true, variant.hint)
		oneOf = append(oneOf, schema)
		mapping[variant.kind] = schema.Ref
	}
	return &huma.Schema{
		OneOf:         oneOf,
		Discriminator: &huma.Discriminator{PropertyName: "type", Mapping: mapping},
	}
}

type StoredSlideContent struct {
	Elements   []StoredSlideElement `json:"elements" nullable:"false"`
	Background string               `json:"background" minLength:"1"`
	Notes      string               `json:"notes"`
}

type SlideContent struct {
	Elements   []SlideElement `json:"elements" nullable:"false"`
	Background string         `json:"background" minLength:"1"`
	Notes      string         `json:"notes"`
}

type SlidePayload struct {
	Content StoredSlideContent `json:"content"`
}

type CreatePresentationInput struct {
	Title              string         `json:"title" minLength:"1" maxLength:"255"`
	ThumbnailAssetID   *string        `json:"thumbnailAssetId,omitempty" format:"uuid" nullable:"true"`
	Slides             []SlidePayload `json:"slides,omitempty" minItems:"1" nullable:"false"`
	SlidesWereProvided bool           `json:"-"`
}

func (input *CreatePresentationInput) UnmarshalJSON(data []byte) error {
	type alias CreatePresentationInput
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*input = CreatePresentationInput(decoded)
	_, input.SlidesWereProvided = fields["slides"]
	return nil
}

type OptionalNullableString struct {
	Present bool
	Value   *string
}

func (value *OptionalNullableString) UnmarshalJSON(data []byte) error {
	value.Present = true
	if string(data) == "null" {
		value.Value = nil
		return nil
	}
	var decoded string
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	value.Value = &decoded
	return nil
}

func (OptionalNullableString) Schema(registry huma.Registry) *huma.Schema {
	schema := registry.Schema(reflect.TypeFor[string](), true, "")
	schema.Nullable = true
	schema.Format = "uuid"
	return schema
}

type UpdatePresentationInput struct {
	Title            *string                `json:"title,omitempty" minLength:"1" maxLength:"255"`
	ThumbnailAssetID OptionalNullableString `json:"thumbnailAssetId,omitempty"`
	Slides           *[]SlidePayload        `json:"slides,omitempty" minItems:"1"`
}

type PresentationCreated struct {
	ID string `json:"id" format:"uuid"`
}

type PresentationSlide struct {
	ID         string       `json:"id" format:"uuid"`
	OrderIndex int          `json:"orderIndex" minimum:"0"`
	Content    SlideContent `json:"content"`
}

type Presentation struct {
	ID           string              `json:"id" format:"uuid"`
	Title        string              `json:"title"`
	ThumbnailURL *string             `json:"thumbnailUrl" format:"uri" nullable:"true"`
	Slides       []PresentationSlide `json:"slides" minItems:"1" nullable:"false"`
	CreatedAt    time.Time           `json:"createdAt" format:"date-time"`
	UpdatedAt    time.Time           `json:"updatedAt" format:"date-time"`
}

type PresentationSummary struct {
	ID           string    `json:"id" format:"uuid"`
	Title        string    `json:"title"`
	ThumbnailURL *string   `json:"thumbnailUrl" format:"uri" nullable:"true"`
	CreatedAt    time.Time `json:"createdAt" format:"date-time"`
	UpdatedAt    time.Time `json:"updatedAt" format:"date-time"`
}

type PresentationList struct {
	Presentations []PresentationSummary `json:"presentations" nullable:"false"`
}

type PresentationRecord struct {
	ID               string
	Title            string
	ThumbnailAssetID sql.NullString
	CreatedAt        string
	UpdatedAt        string
}

type SlideRecord struct {
	ID         string
	OrderIndex int64
	Content    string
	UpdatedAt  string
}

type PresentationPatch struct {
	ID                  string
	Title               string
	SetTitle            bool
	ThumbnailAssetID    sql.NullString
	SetThumbnailAssetID bool
	UpdatedAt           string
}

type PresentationStore interface {
	GetSingleton(context.Context) (string, error)
	GetPresentation(context.Context, string) (PresentationRecord, error)
	ListPresentations(context.Context) ([]PresentationRecord, error)
	ListSlides(context.Context, string) ([]SlideRecord, error)
	GetAsset(context.Context, string) (AssetRecord, error)
	GetAssets(context.Context, []string) ([]AssetRecord, error)
	CreatePresentation(context.Context, PresentationRecord) error
	UpdatePresentation(context.Context, PresentationPatch) error
	DeleteSlides(context.Context, string) error
	CreateSlide(context.Context, string, string, int, string) error
}

type PresentationRepository interface {
	PresentationStore
	WithTx(context.Context, func(PresentationStore) error) error
}

type PresentationError struct {
	Code    string
	Message string
	Details any
}

func (presentationError *PresentationError) Error() string { return presentationError.Message }

type PresentationOptions struct {
	NewID     func() uuid.UUID
	Now       func() time.Time
	URLExpiry time.Duration
}

type Presentations struct {
	repository PresentationRepository
	storage    storage.Storage
	newID      func() uuid.UUID
	now        func() time.Time
	urlExpiry  time.Duration
}

func NewPresentations(repository PresentationRepository, objectStorage storage.Storage, options PresentationOptions) *Presentations {
	newID := options.NewID
	if newID == nil {
		newID = uuid.New
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	expiry := options.URLExpiry
	if expiry <= 0 {
		expiry = 15 * time.Minute
	}
	return &Presentations{repository: repository, storage: objectStorage, newID: newID, now: now, urlExpiry: expiry}
}

var emptySlide = StoredSlideContent{Elements: []StoredSlideElement{}, Background: "#ffffff", Notes: ""}

func (presentations *Presentations) Create(ctx context.Context, input CreatePresentationInput) (PresentationCreated, error) {
	if presentations.repository == nil {
		return PresentationCreated{}, fmt.Errorf("presentation repository is not configured")
	}
	existing, err := presentations.repository.GetSingleton(ctx)
	if err == nil {
		return PresentationCreated{ID: existing}, nil
	}
	if !isNotFound(err) {
		return PresentationCreated{}, fmt.Errorf("load singleton presentation: %w", err)
	}
	slides := input.Slides
	if !input.SlidesWereProvided {
		slides = []SlidePayload{{Content: emptySlide}}
	}
	presentationID := ""
	err = presentations.repository.WithTx(ctx, func(store PresentationStore) error {
		existingID, lookupErr := store.GetSingleton(ctx)
		if lookupErr == nil {
			presentationID = existingID
			return nil
		}
		if !isNotFound(lookupErr) {
			return lookupErr
		}
		if validateErr := presentations.validateAssets(ctx, store, input.ThumbnailAssetID, slides); validateErr != nil {
			return validateErr
		}
		now := presentations.now().UTC().Format(time.RFC3339Nano)
		presentationID = presentations.newID().String()
		thumbnail := sql.NullString{}
		if input.ThumbnailAssetID != nil {
			thumbnail = sql.NullString{String: *input.ThumbnailAssetID, Valid: true}
		}
		if createErr := store.CreatePresentation(ctx, PresentationRecord{
			ID: presentationID, Title: input.Title, ThumbnailAssetID: thumbnail, CreatedAt: now, UpdatedAt: now,
		}); createErr != nil {
			return createErr
		}
		for index, slide := range slides {
			content, marshalErr := json.Marshal(slide.Content)
			if marshalErr != nil {
				return fmt.Errorf("encode slide content: %w", marshalErr)
			}
			if createErr := store.CreateSlide(ctx, presentations.newID().String(), presentationID, index, string(content)); createErr != nil {
				return createErr
			}
		}
		return nil
	})
	if err != nil {
		if existingID, lookupErr := presentations.repository.GetSingleton(ctx); lookupErr == nil {
			return PresentationCreated{ID: existingID}, nil
		}
		return PresentationCreated{}, fmt.Errorf("create presentation transaction: %w", err)
	}
	return PresentationCreated{ID: presentationID}, nil
}

func (presentations *Presentations) Update(ctx context.Context, id string, input UpdatePresentationInput) (Presentation, error) {
	if input.Title == nil && !input.ThumbnailAssetID.Present && input.Slides == nil {
		return Presentation{}, &PresentationError{Code: "validation_error", Message: "At least one of title / thumbnailAssetId / slides must be provided", Details: map[string]any{"field": "body"}}
	}
	if _, err := presentations.repository.GetPresentation(ctx, id); err != nil {
		return Presentation{}, presentations.lookupError(id, err)
	}
	var thumbnail *string
	if input.ThumbnailAssetID.Present {
		thumbnail = input.ThumbnailAssetID.Value
	}
	var slides []SlidePayload
	if input.Slides != nil {
		slides = *input.Slides
	}
	err := presentations.repository.WithTx(ctx, func(store PresentationStore) error {
		if _, lookupErr := store.GetPresentation(ctx, id); lookupErr != nil {
			return presentations.lookupError(id, lookupErr)
		}
		if validateErr := presentations.validateAssets(ctx, store, thumbnail, slides); validateErr != nil {
			return validateErr
		}
		patch := PresentationPatch{ID: id, SetTitle: input.Title != nil, SetThumbnailAssetID: input.ThumbnailAssetID.Present, UpdatedAt: presentations.now().UTC().Format(time.RFC3339Nano)}
		if input.Title != nil {
			patch.Title = *input.Title
		}
		if input.ThumbnailAssetID.Value != nil {
			patch.ThumbnailAssetID = sql.NullString{String: *input.ThumbnailAssetID.Value, Valid: true}
		}
		if updateErr := store.UpdatePresentation(ctx, patch); updateErr != nil {
			return updateErr
		}
		if input.Slides != nil {
			if deleteErr := store.DeleteSlides(ctx, id); deleteErr != nil {
				return deleteErr
			}
			for index, slide := range *input.Slides {
				content, marshalErr := json.Marshal(slide.Content)
				if marshalErr != nil {
					return marshalErr
				}
				if createErr := store.CreateSlide(ctx, presentations.newID().String(), id, index, string(content)); createErr != nil {
					return createErr
				}
			}
		}
		return nil
	})
	if err != nil {
		return Presentation{}, fmt.Errorf("update presentation transaction: %w", err)
	}
	return presentations.Get(ctx, id)
}

func (presentations *Presentations) Get(ctx context.Context, id string) (Presentation, error) {
	record, err := presentations.repository.GetPresentation(ctx, id)
	if err != nil {
		return Presentation{}, presentations.lookupError(id, err)
	}
	slides, err := presentations.repository.ListSlides(ctx, id)
	if err != nil {
		return Presentation{}, fmt.Errorf("list presentation slides: %w", err)
	}
	if len(slides) == 0 || slides[0].OrderIndex != 0 {
		return Presentation{}, &PresentationError{Code: "not_found", Message: fmt.Sprintf("Presentation %s not found", id)}
	}
	response, err := presentations.expand(ctx, record, slides)
	if err != nil {
		return Presentation{}, err
	}
	return response, nil
}

func (presentations *Presentations) List(ctx context.Context) (PresentationList, error) {
	records, err := presentations.repository.ListPresentations(ctx)
	if err != nil {
		return PresentationList{}, fmt.Errorf("list presentations: %w", err)
	}
	result := PresentationList{Presentations: make([]PresentationSummary, 0, len(records))}
	for _, record := range records {
		createdAt, parseErr := parseTime(record.CreatedAt)
		if parseErr != nil {
			return PresentationList{}, parseErr
		}
		updatedAt, parseErr := parseTime(record.UpdatedAt)
		if parseErr != nil {
			return PresentationList{}, parseErr
		}
		thumbnailURL, urlErr := presentations.thumbnailURL(ctx, record)
		if urlErr != nil {
			return PresentationList{}, urlErr
		}
		result.Presentations = append(result.Presentations, PresentationSummary{ID: record.ID, Title: record.Title, ThumbnailURL: thumbnailURL, CreatedAt: createdAt, UpdatedAt: updatedAt})
	}
	return result, nil
}

func (presentations *Presentations) validateAssets(ctx context.Context, store PresentationStore, thumbnail *string, slides []SlidePayload) error {
	ids := map[string]struct{}{}
	if thumbnail != nil {
		ids[*thumbnail] = struct{}{}
	}
	for _, slide := range slides {
		for _, element := range slide.Content.Elements {
			if element.Type == "image" || element.Type == "model" {
				ids[element.AssetID] = struct{}{}
			}
		}
	}
	missing := make([]string, 0)
	idList := sortedIDs(ids)
	assets, err := store.GetAssets(ctx, idList)
	if err != nil {
		return fmt.Errorf("validate assets: %w", err)
	}
	found := make(map[string]struct{}, len(assets))
	for _, asset := range assets {
		found[asset.ID] = struct{}{}
	}
	for _, id := range idList {
		if _, ok := found[id]; !ok {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		field := "slides[].content.elements[].assetId / thumbnailAssetId"
		return &PresentationError{Code: "validation_error", Message: "Unknown asset(s) referenced by " + field, Details: map[string]any{"field": field, "missing": missing}}
	}
	return nil
}

func (presentations *Presentations) expand(ctx context.Context, record PresentationRecord, slideRecords []SlideRecord) (Presentation, error) {
	createdAt, err := parseTime(record.CreatedAt)
	if err != nil {
		return Presentation{}, err
	}
	updatedAt, err := parseTime(record.UpdatedAt)
	if err != nil {
		return Presentation{}, err
	}
	type decodedSlide struct {
		record  SlideRecord
		content StoredSlideContent
	}
	decoded := make([]decodedSlide, 0, len(slideRecords))
	assetIDs := map[string]struct{}{}
	if record.ThumbnailAssetID.Valid {
		assetIDs[record.ThumbnailAssetID.String] = struct{}{}
	}
	for _, slideRecord := range slideRecords {
		var stored StoredSlideContent
		if err := json.Unmarshal([]byte(slideRecord.Content), &stored); err != nil {
			return Presentation{}, fmt.Errorf("decode slide %s content: %w", slideRecord.ID, err)
		}
		for _, element := range stored.Elements {
			if element.Type == "image" || element.Type == "model" {
				assetIDs[element.AssetID] = struct{}{}
			}
		}
		decoded = append(decoded, decodedSlide{record: slideRecord, content: stored})
	}
	assetRecords, err := presentations.repository.GetAssets(ctx, sortedIDs(assetIDs))
	if err != nil {
		return Presentation{}, fmt.Errorf("load presentation assets: %w", err)
	}
	assetsByID := make(map[string]AssetRecord, len(assetRecords))
	for _, asset := range assetRecords {
		assetsByID[asset.ID] = asset
	}
	urlsByID := make(map[string]string, len(assetRecords))
	for id := range assetIDs {
		asset, ok := assetsByID[id]
		if !ok {
			return Presentation{}, fmt.Errorf("asset %s referenced by presentation %s no longer exists", id, record.ID)
		}
		if presentations.storage == nil {
			return Presentation{}, fmt.Errorf("presentation storage is not configured")
		}
		signed, signErr := presentations.storage.PresignGet(ctx, storage.GetRequest{Key: asset.StorageKey, Expires: presentations.urlExpiry})
		if signErr != nil {
			return Presentation{}, fmt.Errorf("presign asset %s: %w", id, signErr)
		}
		urlsByID[id] = signed.URL
	}
	var thumbnailURL *string
	if record.ThumbnailAssetID.Valid {
		url := urlsByID[record.ThumbnailAssetID.String]
		thumbnailURL = &url
	}
	result := Presentation{ID: record.ID, Title: record.Title, ThumbnailURL: thumbnailURL, Slides: make([]PresentationSlide, 0, len(slideRecords)), CreatedAt: createdAt, UpdatedAt: updatedAt}
	for _, slide := range decoded {
		stored, slideRecord := slide.content, slide.record
		content := SlideContent{Elements: make([]SlideElement, 0, len(stored.Elements)), Background: stored.Background, Notes: stored.Notes}
		for _, element := range stored.Elements {
			readElement := SlideElement{StoredSlideElement: element}
			if element.Type == "image" || element.Type == "model" {
				readElement.Src = urlsByID[element.AssetID]
			}
			content.Elements = append(content.Elements, readElement)
		}
		result.Slides = append(result.Slides, PresentationSlide{ID: slideRecord.ID, OrderIndex: int(slideRecord.OrderIndex), Content: content})
	}
	return result, nil
}

func sortedIDs(ids map[string]struct{}) []string {
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func (presentations *Presentations) thumbnailURL(ctx context.Context, record PresentationRecord) (*string, error) {
	if !record.ThumbnailAssetID.Valid {
		return nil, nil
	}
	asset, err := presentations.repository.GetAsset(ctx, record.ThumbnailAssetID.String)
	if err != nil {
		return nil, fmt.Errorf("load thumbnail asset %s: %w", record.ThumbnailAssetID.String, err)
	}
	if presentations.storage == nil {
		return nil, fmt.Errorf("presentation storage is not configured")
	}
	signed, err := presentations.storage.PresignGet(ctx, storage.GetRequest{Key: asset.StorageKey, Expires: presentations.urlExpiry})
	if err != nil {
		return nil, fmt.Errorf("presign thumbnail: %w", err)
	}
	return &signed.URL, nil
}

func (presentations *Presentations) lookupError(id string, err error) error {
	if isNotFound(err) {
		return &PresentationError{Code: "not_found", Message: fmt.Sprintf("Presentation %s not found", id)}
	}
	return fmt.Errorf("load presentation %s: %w", id, err)
}

func isNotFound(err error) bool { return errors.Is(err, sql.ErrNoRows) }

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse database timestamp %q: %w", value, err)
	}
	return parsed.UTC(), nil
}
