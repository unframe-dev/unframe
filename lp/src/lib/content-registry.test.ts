import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContentRegistry } from "./content-registry";

const component = {} as never;

test("buildContentRegistry derives slugs and sorts validated metadata", () => {
  const registry = buildContentRegistry({
    "/src/content/editor-guide.md": {
      default: component,
      metadata: { title: "Editor guide", description: "Edit spatial slides", order: 2 },
    },
    "/src/content/getting-started.md": {
      default: component,
      metadata: { title: "Getting started", description: "Run Unframe", order: 1 },
    },
  });

  assert.deepEqual(
    registry.map(({ slug, title, order }) => ({ slug, title, order })),
    [
      { slug: "getting-started", title: "Getting started", order: 1 },
      { slug: "editor-guide", title: "Editor guide", order: 2 },
    ],
  );
});

test("buildContentRegistry rejects invalid, duplicate, and unsupported content", () => {
  assert.throws(
    () =>
      buildContentRegistry({
        "/src/content/no-description.md": {
          default: component,
          metadata: { title: "Missing", order: 1 },
        },
      }),
    /description/,
  );
  assert.throws(
    () =>
      buildContentRegistry({
        "/src/content/a.md": {
          default: component,
          metadata: { title: "A", description: "A", order: 1 },
        },
        "/another/a.md": {
          default: component,
          metadata: { title: "Other A", description: "Other", order: 2 },
        },
      }),
    /duplicate slug/,
  );
  assert.throws(
    () =>
      buildContentRegistry({
        "/src/content/readme.txt": {
          default: component,
          metadata: { title: "Text", description: "Text", order: 1 },
        },
      }),
    /Markdown/,
  );
});
