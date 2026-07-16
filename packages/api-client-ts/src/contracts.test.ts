import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient } from "./client";
import type {
  CreatePresentationRequest,
  ErrorResponse,
  GetManifestResponse,
  HealthResponse,
  InitAssetRequest,
  InitAssetResponse,
  Presentation,
  SlideElement,
  StoredSlideElement,
  UpdatePresentationRequest,
} from "./types";

test("generated health contract is consumable through the typed OpenAPI client", () => {
  const client = createApiClient({ baseUrl: "http://localhost:8080" });

  assert.ok(client);

  async function getHealth(): Promise<HealthResponse | undefined> {
    const result = await client.GET("/health");
    return result.data;
  }

  const typecheck: () => Promise<HealthResponse | undefined> = getHealth;
  assert.equal(typeof typecheck, "function");

  const error: ErrorResponse = { error: { code: "not_found", message: "Not Found" } };
  assert.equal(error.error.code, "not_found");

  const request: InitAssetRequest = {
    filename: "model.fbx",
    contentType: "application/octet-stream",
    sizeBytes: 1024,
  };
  async function initAsset(): Promise<InitAssetResponse | undefined> {
    const result = await client.POST("/assets/init", { body: request });
    return result.data;
  }
  const initTypecheck: () => Promise<InitAssetResponse | undefined> = initAsset;
  assert.equal(typeof initTypecheck, "function");
});

test("manifest contract exposes the MR projection through the typed client", () => {
  const client = createApiClient({ baseUrl: "http://localhost:8080" });
  async function getManifest(id: string): Promise<GetManifestResponse | undefined> {
    return (await client.GET("/presentations/{id}/manifest", { params: { path: { id } } })).data;
  }
  const manifest: GetManifestResponse = {
    presentationId: "10000000-0000-4000-8000-000000000001",
    title: "Demo",
    slides: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        orderIndex: 0,
        elements: [
          {
            type: "text",
            id: "30000000-0000-4000-8000-000000000001",
            transform: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            text: "hello",
          },
        ],
      },
    ],
    updatedAt: "2026-07-13T12:00:00Z",
  };
  assert.equal(manifest.slides[0]?.elements[0]?.type, "text");
  assert.equal(typeof getManifest, "function");

  // @ts-expect-error manifest intentionally excludes WebApp-only thumbnail data.
  manifest.thumbnailUrl = null;
  // @ts-expect-error manifest slides intentionally exclude background and notes.
  manifest.slides[0]!.background = "#ffffff";
});

test("presentation write and read contracts are consumable through the typed client", () => {
  const client = createApiClient({ baseUrl: "http://localhost:8080" });
  const storedImage: StoredSlideElement = {
    id: "bbbbbbbb-1111-4111-8111-111111111111",
    type: "image",
    assetId: "aaaaaaaa-1111-4111-8111-111111111111",
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
  const request: CreatePresentationRequest = {
    title: "Demo",
    slides: [{ content: { elements: [storedImage], background: "#ffffff", notes: "" } }],
  };
  async function createPresentation() {
    return (await client.POST("/presentations", { body: request })).data;
  }
  const update: UpdatePresentationRequest = { thumbnailAssetId: null };
  // @ts-expect-error at least one update field is required.
  const emptyUpdate: UpdatePresentationRequest = {};
  async function updatePresentation(id: string): Promise<Presentation | undefined> {
    return (await client.PUT("/presentations/{id}", { params: { path: { id } }, body: update }))
      .data;
  }
  async function getPresentation(id: string): Promise<Presentation | undefined> {
    return (await client.GET("/presentations/{id}", { params: { path: { id } } })).data;
  }

  const readImage: SlideElement = { ...storedImage, src: "https://storage.example.test/image.png" };
  assert.equal(readImage.type, "image");
  assert.equal(typeof createPresentation, "function");
  assert.equal(typeof updatePresentation, "function");
  assert.equal(typeof getPresentation, "function");
  assert.ok(emptyUpdate);

  // @ts-expect-error src is a server-populated read-only field and is forbidden on writes.
  const invalidStoredImage: StoredSlideElement = { ...storedImage, src: "https://forbidden.test" };
  assert.ok(invalidStoredImage);
});
