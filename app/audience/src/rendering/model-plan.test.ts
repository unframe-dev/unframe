import { describe, expect, it } from "vitest";
import { buildModelPlan } from "./model-plan";
import { modelFixture as fixture } from "./model-fixture";
describe("model plan", () => {
  it("selects model assets and effective visibility", () => {
    const { delivery, view } = fixture();
    const plan = buildModelPlan(delivery, view);
    expect(plan.assets).toHaveLength(1);
    expect(plan.instances[0]).toMatchObject({
      nodeId: "model",
      assetId: "a",
      opacity: 1,
      visible: true,
    });
  });
  it("rejects unsupported features and budgets before loading", () => {
    const { delivery, view } = fixture();
    delivery.capabilityProfile!.model!.features = [];
    expect(() => buildModelPlan(delivery, view)).toThrow(/feature/);
    delivery.capabilityProfile!.model!.features = [7];
    delivery.capabilityProfile!.limits!.model!.maxVertices = "2";
    expect(() => buildModelPlan(delivery, view)).toThrow(/budget/);
  });
  it("rejects conflicting access metadata", () => {
    const { delivery, view } = fixture();
    delivery.assetAccess![0]!.checksum = "sha256:" + "b".repeat(64);
    expect(() => buildModelPlan(delivery, view)).toThrow(/integrity/);
  });
});

it.each(["delivery", "catalog"])("rejects obsolete v2 %s contracts before rendering", (kind) => {
  const { delivery, view } = fixture();
  if (kind === "delivery") delivery.deliveryContractVersion = 2;
  else delivery.projectionProfile!.runtimeCatalog!.catalogContractVersion = 2;
  expect(() => buildModelPlan(delivery, view)).toThrow();
});

it("rejects frozen Anchor display state before loading media", () => {
  const { delivery, view } = fixture();
  expect(() =>
    buildModelPlan(delivery, {
      ...view,
      frozenAnchors: [{ nodeId: Object.keys(view.nodeStates)[0]!, position: [1, 2, 3] }],
    }),
  ).toThrow(/Anchor/);
});
