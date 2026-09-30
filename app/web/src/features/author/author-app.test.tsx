import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "../../../../../packages/unframe-cli/src/author/contract";
import { AuthorApp } from "./author-app";
import { AuthorApiError, type AuthorApi } from "./api";

const snapshot = (): ProjectSnapshot => ({
  revision: "r1",
  sourceHash: "s1",
  irHash: "i1",
  diagnostics: [],
  instances: ["alpha", "beta"].map((instanceId) => ({
    instanceId,
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
});

describe("Author preview", () => {
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
        edits === 1 ? [{ assetId: "a1", instanceId: "alpha", mediaType: "image/png" }] : [],
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
