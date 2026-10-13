import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import { EditorApp } from "./editor-app";
import { EditorApiError, type EditorApi } from "./api";

const snapshot = (): ProjectSnapshot => ({
  revision: "r1",
  sourceHash: "s1",
  irHash: "i1",
  definition: null,
  diagnostics: [],
  instances: ["alpha", "beta"].map((instanceId) => ({
    instanceId,
    surfaceId: instanceId,
    props: { title: { type: "string" as const, value: instanceId, editable: true } },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    transformEditable: true,
  })),
});
const apiFor = (project: ProjectSnapshot): EditorApi => ({
  project: vi.fn(async () => project),
  patch: vi.fn(async () => ({ revision: "r2", sourceHash: "s2", irHash: "i2", commandId: "c" })),
  build: vi.fn(async (revision) => ({
    buildId: "b1",
    revision,
    channel: "dev" as const,
    generationId: null,
    status: "failed" as const,
    diagnostics: [],
    artifacts: [],
  })),
  job: vi.fn(),
  cancel: vi.fn(),
  publicationAuth: vi.fn(async () => ({ status: "unconfigured" as const })),
  beginPublicationAuth: vi.fn(),
  cancelPublicationAuth: vi.fn(),
  publish: vi.fn(),
  distBuild: vi.fn(),
  preview: vi.fn(),
  confirmDisplay: vi.fn(),
  invalidateDisplay: vi.fn(async () => {}),
});
const createDriver = () => ({
  prepare: vi.fn(async () => "build"),
  commit: vi.fn(async () => "build"),
  discard: vi.fn(async () => {}),
  invalidate: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
});
afterEach(() => vi.restoreAllMocks());

describe("Source Editor", () => {
  it("defers external Dev changes while an explicit Dist build owns the Host", async () => {
    let current = snapshot();
    const api = apiFor(current);
    vi.mocked(api.project).mockImplementation(async () => current);
    let finish!: (job: Awaited<ReturnType<EditorApi["distBuild"]>>) => void;
    vi.mocked(api.distBuild).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await waitFor(() => expect(api.build).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "本番 build" }));
    await waitFor(() => expect(api.distBuild).toHaveBeenCalledOnce());
    current = { ...current, revision: "external" };
    await screen.findByText("保存 revision: external", {}, { timeout: 2500 });
    expect(api.build).toHaveBeenCalledTimes(1);
    finish({
      buildId: "dist",
      channel: "dist",
      generationId: null,
      revision: "r1",
      status: "succeeded",
      diagnostics: [],
      artifacts: [],
    });
    await waitFor(() => expect(api.build).toHaveBeenCalledWith("external", expect.any(String)));
  });
  it("reflects the Host refresh revision without building its own lock update again", async () => {
    const initial = snapshot();
    const refreshed = { ...initial, revision: "refreshed" };
    const api = apiFor(initial);
    vi.mocked(api.project).mockResolvedValueOnce(initial).mockResolvedValue(refreshed);
    vi.mocked(api.build).mockResolvedValue({
      buildId: "b",
      revision: "refreshed",
      channel: "dev",
      generationId: "f".repeat(32),
      status: "succeeded",
      diagnostics: [],
      artifacts: [],
    });
    vi.mocked(api.preview).mockResolvedValue({
      requestId: "request",
      sourceRevision: "refreshed",
      buildManifest: JSON.stringify({ buildId: "build" }),
    });
    render(<EditorApp api={api} createDriver={createDriver} />);
    expect(await screen.findByText("保存 revision: refreshed")).toBeInTheDocument();
    expect(await screen.findByText("build 入力 revision: refreshed")).toBeInTheDocument();
    expect(await screen.findByText("表示 build identity: build")).toBeInTheDocument();
    expect(api.build).toHaveBeenCalledTimes(1);
  });
  it("automatically builds an external saved revision and builds readonly Source", async () => {
    let current = { ...snapshot(), instances: [], irHash: null };
    const api = apiFor(current);
    vi.mocked(api.project).mockImplementation(async () => current);
    render(<EditorApp api={api} createDriver={createDriver} />);
    await waitFor(() => expect(api.build).toHaveBeenCalledWith("r1", expect.any(String)));
    current = { ...current, revision: "external" };
    await waitFor(() => expect(api.build).toHaveBeenCalledWith("external", expect.any(String)), {
      timeout: 2500,
    });
    expect(screen.getByText(/Inspector 編集に対応しない Source/)).toBeInTheDocument();
  });
  it("shows text editor metadata and diagnostic source locations", async () => {
    const initial = snapshot();
    initial.instances[0]!.props["title"]!.editor = { kind: "text" };
    initial.diagnostics.push({
      family: "type",
      code: "compiler-source-type-error",
      message: "Invalid prop type.",
      location: { fileName: "Hero.component.tsx", start: 24, end: 29, line: 2, column: 5 },
    });
    initial.diagnostics.push({
      family: "semantic",
      code: "compiler-binding-invalid",
      message: "Missing binding.",
      path: ["scene", 0, "bindings"],
    });
    const api = apiFor(initial);
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    const editor = screen.getByLabelText("title");
    expect(editor.tagName).toBe("TEXTAREA");
    await user.clear(editor);
    await user.type(editor, "First{enter}second");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          command: {
            kind: "setProp",
            instanceId: "alpha",
            propId: "title",
            value: "First\nsecond",
          },
        }),
      ),
    );
    expect(screen.getByText(/Hero.component.tsx:2:5/)).toBeInTheDocument();
    expect(screen.getByText(/\$\/scene\/0\/bindings/)).toBeInTheDocument();
  });
  it("clears undo history when an external revision appears after save", async () => {
    const initial = snapshot();
    const api = apiFor(initial);
    vi.mocked(api.project)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue({ ...initial, revision: "external", irHash: "other" });
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "changed");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await screen.findByText(/保存後に別の変更を検出/);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
  it("can undo two saved edits in sequence at the latest revision", async () => {
    let current = snapshot();
    const api = apiFor(current);
    vi.mocked(api.project).mockImplementation(async () => current);
    vi.mocked(api.patch).mockImplementation(async (_revision, request) => {
      const revision = `r${Number(current.revision.slice(1)) + 1}`;
      current = {
        ...current,
        revision,
        irHash: `i${revision.slice(1)}`,
        instances: structuredClone(current.instances),
      };
      if (request.command.kind === "setProp")
        current.instances[0]!.props["title"]!.value = request.command.value;
      return {
        revision,
        sourceHash: `s${revision.slice(1)}`,
        irHash: current.irHash!,
        commandId: request.commandId,
      };
    });
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    for (const value of ["one", "two"]) {
      await user.clear(screen.getByLabelText("title"));
      await user.type(screen.getByLabelText("title"), value);
      await user.click(screen.getByRole("button", { name: /^保存$/ }));
      await screen.findByText(`保存 revision: r${value === "one" ? 2 : 3}`);
    }
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("保存 revision: r4");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("保存 revision: r5");
    expect(vi.mocked(api.patch).mock.calls.map((call) => call[1].command)).toEqual([
      { kind: "setProp", instanceId: "alpha", propId: "title", value: "one" },
      { kind: "setProp", instanceId: "alpha", propId: "title", value: "two" },
      { kind: "setProp", instanceId: "alpha", propId: "title", value: "one" },
      { kind: "setProp", instanceId: "alpha", propId: "title", value: "alpha" },
    ]);
  });
  it("undoes a saved inherited prop to inheritance and redoes the override", async () => {
    let current = snapshot();
    current.instances[0]!.props["title"] = {
      ...current.instances[0]!.props["title"]!,
      value: "Shared",
      inherited: true,
    };
    const api = apiFor(current);
    vi.mocked(api.project).mockImplementation(async () => current);
    vi.mocked(api.patch).mockImplementation(async (_revision, request) => {
      const revision = `r${Number(current.revision.slice(1)) + 1}`;
      current = {
        ...current,
        revision,
        irHash: `i${revision.slice(1)}`,
        instances: structuredClone(current.instances),
      };
      current.instances[0]!.props["title"] = {
        ...current.instances[0]!.props["title"]!,
        value: request.command.kind === "setProp" ? request.command.value : "Shared",
        inherited: request.command.kind === "inheritProp",
      };
      return {
        revision,
        sourceHash: `s${revision.slice(1)}`,
        irHash: current.irHash!,
        commandId: request.commandId,
      };
    });
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "Changed");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.patch).mock.calls[1]?.[1].command).toEqual({
      kind: "inheritProp",
      instanceId: "alpha",
      propId: "title",
    });
    await user.click(await screen.findByRole("button", { name: "Redo" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.patch).mock.calls[2]?.[1].command).toEqual({
      kind: "setProp",
      instanceId: "alpha",
      propId: "title",
      value: "Changed",
    });
  });
  it("keeps instance drafts independent and sends only the selected scalar edit", async () => {
    const api = apiFor(snapshot());
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "changed");
    await user.click(screen.getByRole("button", { name: "beta" }));
    expect(screen.getByLabelText("title")).toHaveValue("beta");
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "B");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          command: { kind: "setProp", instanceId: "beta", propId: "title", value: "B" },
        }),
      ),
    );
  });
  it("retries the exact command after an unknown response and blocks new saves until resolved", async () => {
    const api = apiFor(snapshot());
    vi.mocked(api.patch)
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce({ revision: "r2", sourceHash: "s2", irHash: "i2", commandId: "c" });
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "first");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await screen.findByText(/保存結果未確認/);
    expect(screen.getByRole("button", { name: /^保存$/ })).toBeDisabled();
    expect(api.project).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "再読込" }));
    expect(screen.getByRole("button", { name: /同じ内容で再送/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /同じ内容で再送/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.patch).mock.calls[1]).toEqual(vi.mocked(api.patch).mock.calls[0]);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /同じ内容で再送/ })).not.toBeInTheDocument(),
    );
  });

  it.each([
    [412, "editor-revision-mismatch"],
    [422, "editor-source-invalid"],
  ])("discards definitive %i rejection and allows a new edit", async (status, code) => {
    const api = apiFor(snapshot());
    vi.mocked(api.patch).mockRejectedValueOnce(new EditorApiError(status, code, "Rejected."));
    const user = userEvent.setup();
    render(<EditorApp api={api} createDriver={createDriver} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "first");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await screen.findByText(status === 412 ? /保存競合/ : /保存拒否/);
    expect(screen.queryByRole("button", { name: /同じ内容で再送/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^保存$/ })).toBeEnabled();
  });
});

it("keeps an HTTP 500 save response pending for the same-command retry", async () => {
  const api = apiFor(snapshot());
  vi.mocked(api.patch).mockRejectedValueOnce(
    new EditorApiError(500, "editor-io-failed", "I/O failed."),
  );
  const user = userEvent.setup();
  render(<EditorApp api={api} createDriver={createDriver} />);
  await user.click(await screen.findByRole("button", { name: "alpha" }));
  await user.clear(screen.getByLabelText("title"));
  await user.type(screen.getByLabelText("title"), "new");
  await user.click(screen.getByRole("button", { name: /^保存$/ }));
  await screen.findByText(/保存結果未確認/);
  expect(screen.getByRole("button", { name: /同じ内容で再送/ })).toBeInTheDocument();
});
