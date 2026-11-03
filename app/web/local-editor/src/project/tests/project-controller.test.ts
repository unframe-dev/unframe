import { describe, it, expect, vi } from "vite-plus/test";
import type { ProjectSnapshot, PatchRequest } from "@unframe/contracts/author-http";
import { createProjectController } from "../project-controller";
const snapshot = (revision = "r1", value = "before"): ProjectSnapshot => ({
  revision,
  sourceHash: revision,
  irHash: "ir",
  definition: null,
  diagnostics: [],
  instances: [
    {
      instanceId: "card",
      surfaceId: "surface",
      props: { title: { type: "string", value, editable: true } },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      transformEditable: false,
    },
  ],
});
function setup() {
  let current = snapshot();
  const api = {
    projectChanges: vi.fn(async (_cursor?: string, signal?: AbortSignal) => {
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      return { cursor: "a".repeat(32) + ":0", changed: false };
    }),
    project: vi.fn(async () => current),
    patch: vi.fn(async (_revision: string, request: PatchRequest) => {
      current = snapshot("r2", "after");
      return { revision: "r2", sourceHash: "r2", irHash: "ir", commandId: request.commandId };
    }),
  };
  return {
    api,
    controller: createProjectController({ api, newId: () => "a".repeat(32) }),
    update: (next: ProjectSnapshot) => {
      current = next;
    },
  };
}
describe("project controller", () => {
  it("clears a transient project read error after a successful refresh", async () => {
    const { controller, api } = setup();
    api.project.mockRejectedValueOnce(new Error("Project source is busy"));
    await controller.refresh();
    expect(controller.store.getState().error).toContain("Project source is busy");
    await controller.refresh();
    expect(controller.store.getState().error).toBeNull();
    expect(controller.store.getState().project?.revision).toBe("r1");
    controller.dispose();
  });

  it("preserves an uncertain save error when a project refresh succeeds", async () => {
    const { controller, api } = setup();
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("title", "after");
    api.patch.mockRejectedValueOnce(new Error("Save response lost"));
    await controller.saveProp("title");
    await controller.refresh();
    expect(controller.store.getState().error).toContain("Save response lost");
    expect(controller.store.getState().pending).not.toBeNull();
    controller.dispose();
  });

  it("protects dirty props when Source changes externally", async () => {
    const { controller, update } = setup();
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("title", "draft");
    update(snapshot("external", "external"));
    await controller.refresh();
    expect(controller.store.getState()).toMatchObject({
      status: "conflict",
      draft: { props: { title: { value: "draft" } } },
      project: { revision: "external" },
    });
    controller.dispose();
  });
  it("retries an uncertain save using the same command and base revision", async () => {
    const { controller, api } = setup();
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("title", "after");
    api.patch.mockRejectedValueOnce(new Error("disconnected"));
    await controller.saveProp("title");
    expect(controller.store.getState().status).toBe("failed");
    await controller.retry();
    expect(api.patch.mock.calls[1]).toEqual(api.patch.mock.calls[0]);
    expect(controller.store.getState().status).toBe("clean");
    expect(controller.store.getState().undo).toHaveLength(1);
    controller.dispose();
  });
  it("requires an explicit discard before changing a dirty instance", async () => {
    const { controller } = setup();
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("title", "draft");
    expect(controller.selectInstance(null)).toBe(false);
    expect(controller.store.getState().selectedId).toBe("card");
    controller.discard();
    expect(controller.selectInstance(null)).toBe(true);
    controller.dispose();
  });
  it("ignores an old project read completed after a save", async () => {
    const { controller, api } = setup();
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("title", "after");
    let resolve!: (value: ProjectSnapshot) => void;
    api.project.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = controller.refresh();
    await controller.saveProp("title");
    resolve(snapshot());
    await old;
    expect(controller.store.getState().project?.revision).toBe("r2");
    controller.dispose();
  });
  it("saves history only after acknowledgement and restores inherited props on Undo", async () => {
    const { controller, api, update } = setup();
    const initial = snapshot();
    initial.instances[0]!.props.title!.inherited = true;
    initial.instances[0]!.props.title!.inheritanceExpression = "theme.title";
    update(initial);
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("title", "after");
    await controller.saveProp("title");
    await controller.undo();
    expect(api.patch.mock.calls[1]?.[1].command).toEqual({
      kind: "restoreProp",
      instanceId: "card",
      propId: "title",
      expression: "theme.title",
    });
    controller.dispose();
  });
  it("preserves other unsaved props when saving one field", async () => {
    const { controller, update } = setup();
    const initial = snapshot();
    initial.instances[0]!.props.other = { type: "string", value: "original", editable: true };
    update(initial);
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("other", "unsaved");
    controller.editProp("title", "after");
    await controller.saveProp("title");
    expect(controller.store.getState()).toMatchObject({
      status: "dirty",
      draft: { props: { other: { value: "unsaved" } } },
    });
    controller.dispose();
  });
  it("keeps input entered while a saved snapshot is being reloaded", async () => {
    const { controller, api } = setup();
    await controller.refresh();
    controller.selectInstance("card");
    controller.editProp("title", "after");
    let resolve!: (value: ProjectSnapshot) => void;
    api.project.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const saving = controller.saveProp("title");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("clean"));
    controller.editProp("title", "next input");
    resolve(snapshot("r2", "after"));
    await saving;
    expect(controller.store.getState()).toMatchObject({
      status: "dirty",
      draft: { props: { title: { value: "next input" } } },
      project: { instances: [{ props: { title: { value: "after" } } }] },
    });
    controller.dispose();
  });
  it("ignores an older read that completes after a newer read", async () => {
    const { controller, api } = setup();
    let resolve!: (value: ProjectSnapshot) => void;
    api.project
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(snapshot("r2"));
    const old = controller.refresh();
    await controller.refresh();
    resolve(snapshot());
    await old;
    expect(controller.store.getState().project?.revision).toBe("r2");
    controller.dispose();
  });
  it("does not update stores after disposal", async () => {
    const { controller, api } = setup();
    let resolve!: (value: ProjectSnapshot) => void;
    api.project.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = controller.refresh();
    controller.dispose();
    resolve(snapshot());
    await pending;
    expect(controller.store.getState().project).toBeNull();
  });
});

it("reads only after notifications, catches changes during a read and stops observations on disposal", async () => {
  vi.useFakeTimers();
  try {
    const { api, controller } = setup();
    const notifications = [
      Promise.withResolvers<{ cursor: string; changed: boolean }>(),
      Promise.withResolvers<{ cursor: string; changed: boolean }>(),
      Promise.withResolvers<{ cursor: string; changed: boolean }>(),
    ];
    api.projectChanges
      .mockImplementationOnce(() => notifications[0]!.promise)
      .mockImplementationOnce(() => notifications[1]!.promise)
      .mockImplementationOnce(() => notifications[2]!.promise);
    controller.start();
    controller.start();
    notifications[0]!.resolve({ cursor: "first", changed: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.project).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.project).toHaveBeenCalledOnce();
    notifications[1]!.resolve({ cursor: "second", changed: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.project).toHaveBeenCalledTimes(2);
    expect(api.projectChanges.mock.calls[1]?.[0]).toBe("first");
    controller.dispose();
    notifications[2]!.resolve({ cursor: "late", changed: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.project).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("retries a failed read without acknowledging its notification cursor", async () => {
  vi.useFakeTimers();
  try {
    const { api, controller } = setup();
    const change = { cursor: "a".repeat(32) + ":1", changed: true };
    api.projectChanges.mockResolvedValueOnce(change).mockResolvedValueOnce(change);
    api.project.mockRejectedValueOnce(new Error("Transient capture failure"));
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.project).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.project).toHaveBeenCalledTimes(2);
    expect(api.projectChanges.mock.calls.slice(0, 2).map(([cursor]) => cursor)).toEqual([
      undefined,
      undefined,
    ]);
    expect(api.projectChanges.mock.calls[2]?.[0]).toBe(change.cursor);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.project).toHaveBeenCalledTimes(2);
    controller.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it("reconnects at the same cursor and clears its transport error without polling the project", async () => {
  vi.useFakeTimers();
  try {
    const { api, controller } = setup();
    const cursor = "a".repeat(32) + ":1";
    api.projectChanges
      .mockResolvedValueOnce({ cursor, changed: true })
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValueOnce({ cursor, changed: false });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.store.getState().error).toContain("Connection interrupted");
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.projectChanges.mock.calls[2]?.[0]).toBe(cursor);
    expect(api.project).toHaveBeenCalledOnce();
    expect(controller.store.getState().error).toBeNull();
    controller.dispose();
  } finally {
    vi.useRealTimers();
  }
});
