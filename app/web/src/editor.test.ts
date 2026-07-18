import { describe, expect, it } from "vitest";
import { addSlide, createInitialEditorState } from "./editor";

describe("editor scaffold", () => {
  it("starts with one slide", () => {
    expect(createInitialEditorState()).toEqual({
      title: "Untitled presentation",
      slideCount: 1,
    });
  });

  it("preserves the current title when adding a slide", () => {
    const state = { title: "Demo", slideCount: 2 };

    expect(addSlide(state)).toEqual({ title: "Demo", slideCount: 3 });
  });
});
