import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import { WorkspaceProvider } from "../../app/workspace-provider";
import type { Workspace } from "../../workspace/create-workspace";
import { createUiStore } from "../../workspace/ui-store";
import { createProjectStore } from "../project-store";
import { PropsField } from "../props-field";

function fixture() {
  const ui = createUiStore("dark");
  const project = createProjectStore();
  project.setState({ selectedId: "shape" });
  // Render the retained client snapshot instead of Zustand's hydration snapshot.
  ui.getInitialState = ui.getState;
  project.getInitialState = project.getState;
  const workspace = { ui, project: { store: project } } as Workspace;
  const render = (value = 3) =>
    renderToStaticMarkup(
      createElement(WorkspaceProvider, {
        workspace,
        children: createElement(PropsField, {
          id: "width",
          prop: { type: "number", editable: true, value },
          disabled: false,
          changed: false,
          onChange() {},
          onSave() {},
        }),
      }),
    );
  return { ui, render };
}
it("retains incomplete numeric input when its field view is recreated", () => {
  const { ui, render } = fixture();
  ui.setState({ propInputs: { '["shape","width"]': { value: 3, text: "" } } });
  expect(render()).toContain('value=""');
  expect(render()).toContain('aria-invalid="true"');
});
it("replaces old field text when the underlying Props value changes", () => {
  const { ui, render } = fixture();
  ui.setState({ propInputs: { '["shape","width"]': { value: 3, text: "" } } });
  expect(render(4)).toContain('value="4"');
  expect(render(4)).toContain('aria-invalid="false"');
});
