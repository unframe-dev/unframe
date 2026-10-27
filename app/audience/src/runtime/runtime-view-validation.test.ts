import { expect, test } from "vitest";
import type {
  ParticipantRuntimeViewWire,
  ProjectedRuntimeCatalogWire,
} from "@unframe/contracts/presentation";
import { validateRuntimeView } from "./runtime-view-validation";

test("validation uses each supplied Group cut without retaining or mutating session state", () => {
  const catalog: ProjectedRuntimeCatalogWire = {
    nodes: [
      {
        nodeId: "intro-node",
        parent: { stage: {} },
        owner: { group: { groupId: "intro" } },
        container: {},
      },
    ],
  };
  const view: ParticipantRuntimeViewWire = {
    projectionProfileId: "audience",
    assignmentEpoch: "1",
    progression: {
      currentGroupId: "intro",
      groupEntryEpoch: "1",
      currentStepId: "start",
      stepEntryEpoch: "1",
      stable: {},
    },
    clock: { running: {} },
    presentationOrigin: { pose: { position: {}, rotation: { w: 1 } } },
  };
  const originalView = structuredClone(view);
  const originalCatalog = structuredClone(catalog);
  const context = { catalog, assignmentEpoch: "1" };
  expect(validateRuntimeView(view, { ...context, groupExited: true }).nodeStates).toEqual({});
  expect(() => validateRuntimeView(view, context)).toThrow("invalid-runtime-input");
  expect(validateRuntimeView(view, { ...context, groupExited: true }).nodeStates).toEqual({});
  expect(view).toEqual(originalView);
  expect(catalog).toEqual(originalCatalog);
});
