import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import type { ProjectSnapshot } from "@unframe-dev/contracts/author-http";
import definition from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import { WorkspaceProvider } from "../../app/workspace-provider";
import { DiagnosticsPanel } from "../../diagnostics/diagnostics-panel";
import { createPreviewStore } from "../../preview/preview-store";
import { createProjectStore } from "../../project/project-store";
import { createPublicationStore } from "../../publication/publication-store";
import type { Workspace } from "../../workspace/create-workspace";
import { createUiStore } from "../../workspace/ui-store";
import { FlowTree } from "../flow-tree";

function fixture() {
  const project = createProjectStore();
  project.getInitialState = project.getState;
  const workspace = {
    project: { store: project },
    preview: { store: createPreviewStore() },
    publication: { store: createPublicationStore() },
    ui: createUiStore("light"),
  } as Workspace;
  const render = (component: ComponentType = FlowTree) =>
    renderToStaticMarkup(
      createElement(WorkspaceProvider, { workspace, children: createElement(component) }),
    );
  return { project, render };
}

const snapshot: ProjectSnapshot = {
  revision: "r1",
  sourceHash: "source",
  irHash: null,
  definition: null,
  diagnostics: [{ code: "compiler-invalid-declaration", message: "Invalid Source", path: [] }],
  instances: [],
};

it("shows a loading status before the first Source result instead of a validation error", () => {
  const { render } = fixture();
  const html = render();
  expect(html).toContain("Source を読み込んでいます…");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("検証できません");
  expect(html).not.toContain("問題パネル");
  expect(html).not.toContain('role="alert"');
});

it("reports validation failure only after receiving an invalid Source result", () => {
  const { project, render } = fixture();
  project.setState({ project: snapshot });
  const html = render();
  expect(html).toContain("Source の定義を検証できません。問題パネルを確認してください。");
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("読み込んでいます");
});

it("distinguishes a failed Source read and exposes its cause in the problem panel", () => {
  const { project, render } = fixture();
  project.setState({ error: "Host connection failed" });
  const html = render();
  expect(html).toContain("Source を読み込めません。問題パネルを確認してください。");
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("検証できません");
  const diagnostics = render(DiagnosticsPanel);
  expect(diagnostics).toContain("Host connection failed");
  expect(diagnostics).not.toContain("問題なし");
});

it("replaces the loading status with the flow when a valid Source result arrives", () => {
  const { project, render } = fixture();
  project.setState({
    project: {
      ...snapshot,
      definition: definition as unknown as NonNullable<ProjectSnapshot["definition"]>,
      irHash: "ir",
      diagnostics: [],
    },
  });
  const html = render();
  expect(html).toContain("intro");
  expect(html).not.toContain("読み込んでいます");
  expect(html).not.toContain("検証できません");
});
