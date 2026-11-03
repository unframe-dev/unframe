import { expect, it, vi } from "vite-plus/test";
import { reuseEditorSession } from "../editor-session";

function session(token = "host-a", readOnly = false) {
  return {
    token,
    readOnly,
    target: {} as HTMLElement,
    workspace: {
      ui: { selected: "cue", leftOpen: false },
      draft: { title: "未保存" },
    },
    close: vi.fn(),
  };
}
it("keeps the same Host session and all editing state across a UI update without a fragment", () => {
  const current = session();
  const next = reuseEditorSession(current, null, current.target, false);
  expect(next).toBe(current);
  expect(next?.workspace.draft.title).toBe("未保存");
  expect(next?.workspace.ui).toEqual({ selected: "cue", leftOpen: false });
  expect(current.close).not.toHaveBeenCalled();
});
it("closes a previous Host session before replacing its token", () => {
  const current = session();
  expect(reuseEditorSession(current, "host-b", current.target, false)).toBeNull();
  expect(current.close).toHaveBeenCalledOnce();
});
it("does not carry a writable workspace into the read-only Dist view", () => {
  const current = session();
  expect(reuseEditorSession(current, null, current.target, true)).toBeNull();
  expect(current.close).toHaveBeenCalledOnce();
});
it("does not carry a root attached to a replaced document target", () => {
  const current = session();
  expect(reuseEditorSession(current, null, {} as HTMLElement, false)).toBeNull();
  expect(current.close).toHaveBeenCalledOnce();
});
it("does not invent a session when the authenticated entry is missing", () => {
  expect(reuseEditorSession(undefined, null, {} as HTMLElement, false)).toBeNull();
});
