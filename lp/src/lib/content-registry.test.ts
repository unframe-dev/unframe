import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContentRegistry } from "./content-registry";

const component = {} as never;

test("buildContentRegistry derives slugs and sorts validated metadata", () => {
  const registry = buildContentRegistry({
    "/src/content/editor-guide.mdx": {
      default: component,
      metadata: { description: "Edit spatial slides", order: 2, title: "Editor guide" },
    },
    "/src/content/getting-started.md": {
      default: component,
      metadata: { description: "Run Unframe", order: 1, title: "Getting started" },
    },
  });

  assert.deepEqual(
    registry.map(({ order, slug, title }) => ({ order, slug, title })),
    [
      { order: 1, slug: "getting-started", title: "Getting started" },
      { order: 2, slug: "editor-guide", title: "Editor guide" },
    ],
  );
});

test("buildContentRegistry accepts MDX files and removes the MDX extension", () => {
  const registry = buildContentRegistry({
    "/src/content/welcome.mdx": {
      default: component,
      metadata: { description: "Start here", order: 1, title: "Welcome" },
    },
  });

  assert.equal(registry[0]?.slug, "welcome");
});

test("buildContentRegistry rejects invalid, duplicate, and unsupported content", () => {
  assert.throws(
    () =>
      buildContentRegistry({
        "/src/content/no-description.md": {
          default: component,
          metadata: { order: 1, title: "Missing" },
        },
      }),
    /description/,
  );
  assert.throws(
    () =>
      buildContentRegistry({
        "/another/a.md": {
          default: component,
          metadata: { description: "Other", order: 2, title: "Other A" },
        },
        "/src/content/a.md": {
          default: component,
          metadata: { description: "A", order: 1, title: "A" },
        },
      }),
    /duplicate slug/,
  );
  assert.throws(
    () =>
      buildContentRegistry({
        "/src/content/readme.txt": {
          default: component,
          metadata: { description: "Text", order: 1, title: "Text" },
        },
      }),
    /Markdown or MDX/,
  );
});
