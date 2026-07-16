import type { components } from "./generated/schema";

export type ErrorBody = components["schemas"]["ErrorBody"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type HealthResponse = components["schemas"]["HealthResponse"];
export type InitAssetRequest = components["schemas"]["InitAssetInput"];
export type InitAssetResponse = components["schemas"]["InitAssetOutput"];
export type Vec3 = components["schemas"]["Vec3"];
export type Transform = components["schemas"]["Transform"];
export type TextElement = components["schemas"]["TextElement"];
export type StoredModelElement = components["schemas"]["StoredModelElement"];
export type ModelElement = components["schemas"]["ModelElement"];
export type StoredImageElement = components["schemas"]["StoredImageElement"];
export type ImageElement = components["schemas"]["ImageElement"];
export type ShapeElement = components["schemas"]["ShapeElement"];
export type StoredSlideContent = components["schemas"]["StoredSlideContent"];
export type StoredSlideElement = StoredSlideContent["elements"][number];
export type SlideContent = components["schemas"]["SlideContent"];
export type SlideElement = SlideContent["elements"][number];
export type SlidePayload = components["schemas"]["SlidePayload"];
export type CreatePresentationRequest = components["schemas"]["CreatePresentationInput"];
type UpdatePresentationFields = {
  title?: NonNullable<components["schemas"]["CreatePresentationInput"]["title"]>;
  thumbnailAssetId?: Exclude<
    components["schemas"]["CreatePresentationInput"]["thumbnailAssetId"],
    undefined
  >;
  slides?: NonNullable<components["schemas"]["CreatePresentationInput"]["slides"]>;
};
type AtLeastOne<Value, Keys extends keyof Value = keyof Value> = Partial<Value> &
  { [Key in Keys]-?: Required<Pick<Value, Key>> }[Keys];
export type UpdatePresentationRequest = AtLeastOne<UpdatePresentationFields>;
export type PresentationCreatedResponse = components["schemas"]["PresentationCreated"];
export type PresentationSummary = components["schemas"]["PresentationSummary"];
export type PresentationListResponse = components["schemas"]["PresentationList"];
export type PresentationSlide = components["schemas"]["PresentationSlide"];
export type Presentation = components["schemas"]["Presentation"];
export type ManifestAsset = components["schemas"]["ManifestAsset"];
export type ManifestTextElement = components["schemas"]["ManifestTextElement"];
export type ManifestModelElement = components["schemas"]["ManifestModelElement"];
export type ManifestImageElement = components["schemas"]["ManifestImageElement"];
export type ManifestShapeElement = components["schemas"]["ManifestShapeElement"];
export type ManifestSlide = components["schemas"]["ManifestSlide"];
export type ManifestElement = ManifestSlide["elements"][number];
export type GetManifestResponse = components["schemas"]["Manifest"];
