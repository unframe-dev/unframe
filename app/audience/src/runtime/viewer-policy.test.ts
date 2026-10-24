import { expect, it } from "vitest";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import fixture from "../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { assertViewerDelivery, assertViewerInputs } from "./viewer-policy";

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
