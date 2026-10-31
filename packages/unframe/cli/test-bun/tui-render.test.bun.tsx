import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { initialPresentationTuiState } from "../src/tui/model.js";
import { PresentationTuiView } from "../src/tui/view.js";

test("renders the command palette and keyboard help", async () => {
  const setup = await testRender(
    () => <PresentationTuiView state={initialPresentationTuiState} />,
    { height: 14, width: 72 },
  );

  await setup.renderOnce();
  const frame = setup.captureCharFrame();

  expect(frame).toContain("Unframe Presentation");
  expect(frame).toContain("> Check presentation");
  expect(frame).toContain("Build presentation");
  expect(frame).toContain("↑/↓ navigate");

  setup.renderer.destroy();
});
