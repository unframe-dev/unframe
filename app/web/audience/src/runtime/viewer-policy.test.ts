import { expect, it } from "vitest";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import fixture from "../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import {
  assertViewerDelivery,
  assertViewerInputs,
  assertViewerRuntimeCapabilities,
  viewerRuntimeCapabilities,
} from "./viewer-policy";

it("accepts only an explicit Viewer projection for Audience", () => {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  for (const role of [undefined, 0, 1, 3]) {
    delivery.projectionProfile!.key!.role = role as number;
    expect(() => assertViewerDelivery(delivery)).toThrow();
  }
  delivery.projectionProfile!.key!.role = 2;
  expect(() => assertViewerDelivery(delivery)).not.toThrow();
  expect(() => assertViewerDelivery({} as DeliveryManifestWire)).toThrow();
});
it("keeps Viewer logical inputs disabled and rejects Presenter input state", () => {
  expect(() => assertViewerInputs(undefined)).not.toThrow();
  expect(() => assertViewerInputs([])).not.toThrow();
  expect(() => assertViewerInputs(["next"])).toThrow();
});

it("advertises only Viewer runtime capabilities, including mandatory v3 replacement support", () => {
  expect(viewerRuntimeCapabilities).toEqual([1, 2, 3, 4, 5, 8, 9, 10]);
  expect(() => assertViewerRuntimeCapabilities([1, 4, 5, 8, 9, 10])).not.toThrow();
});
it.each([0, 6, 7, 11])("rejects unsupported required runtime capability %s", (capability) => {
  expect(() => assertViewerRuntimeCapabilities([capability])).toThrow(/unsupported/);
});
