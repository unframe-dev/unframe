import assert from "node:assert/strict";
import { test } from "node:test";
import { patchRequestSchema, projectSnapshotSchema, buildJobSchema } from "../src/author-http";

test("Author HTTP validates stale-edit preconditions and rejects unsupported commands", () => {
  assert.equal(
    patchRequestSchema.safeParse({
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
      command: { kind: "setProp", instanceId: "i", propId: "title", value: "Hi" },
    }).success,
    true,
  );
  assert.equal(
    patchRequestSchema.safeParse({
      commandId: "a".repeat(32),
      command: { kind: "setProp", instanceId: "i", propId: "title", value: "Hi" },
    }).success,
    false,
  );
  assert.equal(
    patchRequestSchema.safeParse({
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
      command: { kind: "unknown" },
    }).success,
    false,
  );
});
test("Author HTTP validates project and build response bodies", () => {
  assert.equal(
    projectSnapshotSchema.safeParse({
      revision: "r",
      sourceHash: "s",
      irHash: null,
      definition: null,
      instances: [],
      diagnostics: [],
    }).success,
    true,
  );
  assert.equal(
    buildJobSchema.safeParse({
      buildId: "b",
      channel: "dev",
      revision: "r",
      generationId: null,
      status: "succeeded",
      diagnostics: [],
      artifacts: [],
    }).success,
    true,
  );
  assert.equal(buildJobSchema.safeParse({ buildId: "b", status: "unknown" }).success, false);
});

test("Author HTTP dev Preview selects a completed Build rather than internal storage handles", async () => {
  const { previewRequestSchema } = await import("../src/author-http");
  assert.equal(
    previewRequestSchema.safeParse({
      requestId: "a".repeat(32),
      channel: "dev",
      buildId: "b".repeat(32),
    }).success,
    true,
  );
  assert.equal(
    previewRequestSchema.safeParse({
      requestId: "a".repeat(32),
      channel: "dev",
      generationId: "b".repeat(32),
      sourceRevision: "r",
    }).success,
    false,
  );
});
