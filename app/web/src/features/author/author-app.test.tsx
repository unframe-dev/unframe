import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "../../../../../packages/unframe-cli/src/author/contract";
import type { PresentationDefinition } from "@unframe/unframe-core/domain/model";
import { AuthorApp } from "./author-app";
import { AuthorApiError, type AuthorApi } from "./api";

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
const apiFor = (project: ProjectSnapshot): AuthorApi => ({
  project: vi.fn(async () => project),
  patch: vi.fn(async () => ({ revision: "r2", sourceHash: "s2", irHash: "i2", commandId: "c" })),
  build: vi.fn(async () => ({
    buildId: "b1",
    revision: "r2",
    status: "failed" as const,
    diagnostics: [],
    artifacts: [],
  })),
  job: vi.fn(),
  cancel: vi.fn(),
  artifact: vi.fn(),
});
afterEach(() => vi.restoreAllMocks());

describe("Author inspector", () => {
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
    render(<AuthorApp api={api} />);
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
    render(<AuthorApp api={api} />);
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
    render(<AuthorApp api={api} />);
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
    render(<AuthorApp api={api} />);
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
    render(<AuthorApp api={api} />);
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
  it("marks an older preview stale after a saved edit", async () => {
    const old = snapshot();
    let current = old;
    const api = apiFor(old);
    vi.mocked(api.project).mockImplementation(async () => current);
    vi.mocked(api.patch).mockImplementation(async () => {
      current = { ...old, revision: "r2", sourceHash: "s2", irHash: "i2" };
      return { revision: "r2", sourceHash: "s2", irHash: "i2", commandId: "c" };
    });
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "next");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await waitFor(() => expect(screen.getByText(/保存 revision: r2/)).toBeInTheDocument());
    expect(api.build).toHaveBeenCalledWith("r2", expect.any(String));
  });
  it("re-enables preview after a save supersedes a running build", async () => {
    const old = snapshot();
    let current = old;
    const api = apiFor(old);
    const running = {
      buildId: "b1",
      revision: "r1",
      status: "running" as const,
      diagnostics: [],
      artifacts: [],
    };
    vi.mocked(api.project).mockImplementation(async () => current);
    vi.mocked(api.build).mockImplementation(async (revision) => {
      if (revision === "r1") return running;
      throw new AuthorApiError(409, "author-build-busy", "old build is stopping");
    });
    vi.mocked(api.patch).mockImplementation(async () => {
      current = { ...old, revision: "r2", sourceHash: "s2", irHash: "i2" };
      return { revision: "r2", sourceHash: "s2", irHash: "i2", commandId: "c" };
    });
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.click(screen.getByRole("button", { name: "Preview を生成" }));
    await screen.findByText(/build: running/);
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "next");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await waitFor(() => expect(api.build).toHaveBeenCalledWith("r2", expect.any(String)));
    expect(screen.getByRole("button", { name: "Preview を生成" })).toBeEnabled();
  });
});

const interactiveSnapshot = (): ProjectSnapshot => {
  const project = snapshot();
  project.definition = {
    scene: {
      nodes: {
        host: {
          id: "host",
          kind: "surface",
          surfaceId: "alpha",
          owner: { kind: "presentation" },
          active: true,
          visible: true,
          opacity: 1,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        },
      },
      surfaces: {
        alpha: {
          id: "alpha",
          hostNodeId: "host",
          initialStateId: "hidden",
          interactions: {
            reveal: { id: "reveal", kind: "click", event: "reveal", hitPriority: 0 },
            ignored: { id: "ignored", kind: "click", event: "ignored", hitPriority: 0 },
            back: { id: "back", kind: "click", event: "back", hitPriority: 0 },
          },
          states: {
            hidden: { id: "hidden", enabledInteractionIds: ["reveal", "ignored"] },
            shown: { id: "shown", enabledInteractionIds: ["back"] },
          },
        },
      },
    },
    flow: {
      initialGroupId: "main",
      groups: {
        main: {
          initialStepId: "first",
          steps: {
            first: {
              cues: [
                {
                  id: "show",
                  priority: 0,
                  order: 0,
                  trigger: {
                    kind: "surfaceInteraction",
                    surfaceId: "alpha",
                    interactionId: "reveal",
                    actor: { kind: "presenter" },
                  },
                  firePolicy: { kind: "oncePerStepEntry" },
                  actions: [
                    {
                      kind: "surface.setState",
                      surfaceId: "alpha",
                      stateId: "shown",
                      transition: {
                        kind: "crossfade",
                        durationMilliseconds: 100,
                        easing: "linear",
                        completion: "blocking",
                      },
                    },
                  ],
                  next: { kind: "stay" },
                },
                {
                  id: "hide",
                  priority: 0,
                  order: 1,
                  trigger: {
                    kind: "surfaceInteraction",
                    surfaceId: "alpha",
                    interactionId: "back",
                    actor: { kind: "presenter" },
                  },
                  firePolicy: { kind: "repeatable", cooldownMilliseconds: 0 },
                  actions: [
                    {
                      kind: "surface.setState",
                      surfaceId: "alpha",
                      stateId: "hidden",
                      transition: { kind: "cut" },
                    },
                  ],
                  next: { kind: "stay" },
                },
              ],
            },
          },
        },
      },
      variables: {},
      timelines: {},
    },
  } as unknown as PresentationDefinition;
  return project;
};

describe("Author preview", () => {
  it("allows an interaction from an empty State to a State with a PNG", async () => {
    const api = apiFor(interactiveSnapshot());
    vi.mocked(api.build).mockResolvedValue({
      buildId: "b1",
      revision: "r1",
      status: "succeeded",
      diagnostics: [],
      artifacts: [
        { assetId: "shown-png", instanceId: "alpha", stateId: "shown", mediaType: "image/png" },
      ],
    });
    vi.mocked(api.artifact).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:shown"),
        revokeObjectURL: vi.fn(),
      }),
    );
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.click(screen.getByRole("button", { name: "Preview を生成" }));
    await screen.findByText(/preview 更新: r1/);
    expect(screen.queryByAltText("alpha preview")).not.toBeInTheDocument();
    const reveal = screen.getByRole("button", { name: "reveal" });
    expect(reveal).toBeEnabled();
    await user.click(reveal);
    expect(screen.getByAltText("alpha preview")).toHaveAttribute("src", "blob:shown");
  });
  it("discards an older artifact response after the project revision changes", async () => {
    const initial = snapshot();
    const api = apiFor(initial);
    vi.mocked(api.project)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue({ ...initial, revision: "r2" });
    vi.mocked(api.build).mockResolvedValue({
      buildId: "b1",
      revision: "r1",
      status: "succeeded",
      diagnostics: [],
      artifacts: [
        { assetId: "old", instanceId: "alpha", stateId: "default", mediaType: "image/png" },
      ],
    });
    let resolveArtifact!: (blob: Blob) => void;
    vi.mocked(api.artifact).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveArtifact = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.click(screen.getByRole("button", { name: "Preview を生成" }));
    await waitFor(() => expect(api.artifact).toHaveBeenCalledWith("b1", "old"));
    await user.click(screen.getByRole("button", { name: "再読込" }));
    await screen.findByText(/保存 revision: r2/);
    await act(async () => resolveArtifact(new Blob(["old"], { type: "image/png" })));
    expect(screen.queryByAltText("alpha preview")).not.toBeInTheDocument();
  });
  it("applies an enabled presenter interaction through Cue and shows its State PNG", async () => {
    const project = interactiveSnapshot();
    const api = apiFor(project);
    vi.mocked(api.build).mockResolvedValue({
      buildId: "b1",
      revision: "r1",
      status: "succeeded",
      diagnostics: [],
      artifacts: [
        { assetId: "hidden-png", instanceId: "alpha", stateId: "hidden", mediaType: "image/png" },
        { assetId: "shown-png", instanceId: "alpha", stateId: "shown", mediaType: "image/png" },
      ],
    });
    vi.mocked(api.artifact).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi
          .fn()
          .mockReturnValueOnce("blob:hidden")
          .mockReturnValueOnce("blob:shown"),
        revokeObjectURL: vi.fn(),
      }),
    );
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.click(screen.getByRole("button", { name: "Preview を生成" }));
    expect(await screen.findByAltText("alpha preview")).toHaveAttribute("src", "blob:hidden");
    await user.click(screen.getByRole("button", { name: "ignored" }));
    expect(screen.getByAltText("alpha preview")).toHaveAttribute("src", "blob:hidden");
    expect(screen.getByRole("button", { name: "ignored" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "reveal" }));
    expect(screen.getByAltText("alpha preview")).toHaveAttribute("src", "blob:shown");
    expect(screen.queryByRole("button", { name: "reveal" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByAltText("alpha preview")).toHaveAttribute("src", "blob:hidden");
  });
  it("continues polling when cancellation returns a running job", async () => {
    const api = apiFor(snapshot());
    const running = {
      buildId: "b1",
      revision: "r1",
      status: "running" as const,
      diagnostics: [],
      artifacts: [],
    };
    vi.mocked(api.build).mockResolvedValue(running);
    vi.mocked(api.cancel).mockResolvedValue(running);
    vi.mocked(api.job).mockResolvedValue({ ...running, status: "cancelled" });
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await screen.findByRole("button", { name: "alpha" });
    await user.click(screen.getByRole("button", { name: "Preview を生成" }));
    await screen.findByText(/build: running/);
    await user.click(screen.getByRole("button", { name: "中止" }));
    await screen.findByText(/build: cancelled/);
    expect(screen.getByRole("button", { name: "Preview を生成" })).toBeEnabled();
  });

  it("keeps the terminal status when an older cancellation response arrives", async () => {
    const api = apiFor(snapshot());
    const running = {
      buildId: "b1",
      revision: "r1",
      status: "running" as const,
      diagnostics: [],
      artifacts: [],
    };
    let finishCancel!: (job: Awaited<ReturnType<AuthorApi["cancel"]>>) => void;
    vi.mocked(api.build).mockResolvedValue(running);
    vi.mocked(api.cancel).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCancel = resolve;
        }),
    );
    vi.mocked(api.job).mockResolvedValue({ ...running, status: "cancelled" });
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await screen.findByRole("button", { name: "alpha" });
    await user.click(screen.getByRole("button", { name: "Preview を生成" }));
    await screen.findByText(/build: running/);
    await user.click(screen.getByRole("button", { name: "中止" }));
    await screen.findByText(/build: cancelled/);
    await act(async () => {
      finishCancel(running);
    });
    expect(screen.getByText(/build: cancelled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview を生成" })).toBeEnabled();
  });

  it("accepts only one build request while the first response is pending", async () => {
    const api = apiFor(snapshot());
    let resolveBuild!: (job: Awaited<ReturnType<AuthorApi["build"]>>) => void;
    vi.mocked(api.build).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBuild = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await screen.findByRole("button", { name: "alpha" });
    const button = screen.getByRole("button", { name: "Preview を生成" });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(api.build).toHaveBeenCalledTimes(1);
    resolveBuild({
      buildId: "b1",
      revision: "r1",
      status: "succeeded",
      diagnostics: [],
      artifacts: [],
    });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("keeps the last successful PNG when a later build fails", async () => {
    const initial = snapshot();
    let current = initial;
    const api = apiFor(initial);
    vi.mocked(api.project).mockImplementation(async () => current);
    let edits = 0;
    vi.mocked(api.patch).mockImplementation(async () => {
      edits++;
      current = { ...current, revision: `r${edits + 1}`, irHash: `i${edits + 1}` };
      return {
        revision: current.revision,
        sourceHash: current.sourceHash,
        irHash: current.irHash!,
        commandId: "c",
      };
    });
    vi.mocked(api.build).mockImplementation(async (revision) => ({
      buildId: "b1",
      revision,
      status: edits === 1 ? "succeeded" : "failed",
      diagnostics: [],
      artifacts:
        edits === 1
          ? [{ assetId: "a1", instanceId: "alpha", stateId: "default", mediaType: "image/png" }]
          : [],
    }));
    vi.mocked(api.artifact).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:preview"),
        revokeObjectURL: vi.fn(),
      }),
    );
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "alpha" }));
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "first");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await screen.findByAltText("alpha preview");
    await user.clear(screen.getByLabelText("title"));
    await user.type(screen.getByLabelText("title"), "second");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    await waitFor(() => expect(screen.getByText(/保存 revision: r3/)).toBeInTheDocument());
    expect(screen.getByAltText("alpha preview")).toHaveAttribute("src", "blob:preview");
    expect(screen.getByText(/表示 revision: r2.*stale/)).toBeInTheDocument();
  });
});

it("can reload external source changes without sending an edit", async () => {
  const api = apiFor(snapshot());
  const user = userEvent.setup();
  render(<AuthorApp api={api} />);
  await screen.findByRole("button", { name: "alpha" });
  vi.mocked(api.project).mockResolvedValue({ ...snapshot(), revision: "external" });
  await user.click(screen.getByRole("button", { name: "再読込" }));
  await screen.findByText(/保存 revision: external/);
  expect(api.patch).not.toHaveBeenCalled();
});

describe("uncertain save response", () => {
  it("retries the exact command after an unknown response and blocks new saves until resolved", async () => {
    const api = apiFor(snapshot());
    vi.mocked(api.patch)
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce({ revision: "r2", sourceHash: "s2", irHash: "i2", commandId: "c" });
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
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
    [412, "author-revision-mismatch"],
    [422, "author-source-invalid"],
  ])("discards definitive %i rejection and allows a new edit", async (status, code) => {
    const api = apiFor(snapshot());
    vi.mocked(api.patch).mockRejectedValueOnce(new AuthorApiError(status, code, "Rejected."));
    const user = userEvent.setup();
    render(<AuthorApp api={api} />);
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
    new AuthorApiError(500, "author-io-failed", "I/O failed."),
  );
  const user = userEvent.setup();
  render(<AuthorApp api={api} />);
  await user.click(await screen.findByRole("button", { name: "alpha" }));
  await user.clear(screen.getByLabelText("title"));
  await user.type(screen.getByLabelText("title"), "new");
  await user.click(screen.getByRole("button", { name: /^保存$/ }));
  await screen.findByText(/保存結果未確認/);
  expect(screen.getByRole("button", { name: /同じ内容で再送/ })).toBeInTheDocument();
});
