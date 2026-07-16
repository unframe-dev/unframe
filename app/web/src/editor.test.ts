import assert from "node:assert/strict";
import { test } from "node:test";
import { addSlide, createInitialEditorState } from "./editor";

test("editor starts with one slide", () => {
  assert.deepEqual(createInitialEditorState(), {
    title: "Untitled presentation",
    slideCount: 1,
  });
});

test("adding a slide preserves the current title", () => {
  const state = { title: "Demo", slideCount: 2 };

  assert.deepEqual(addSlide(state), { title: "Demo", slideCount: 3 });
});
