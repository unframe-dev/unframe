import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import {
  createPreviewStore,
  type PreviewPhase,
  type PreviewSnapshot,
} from "../../preview/preview-store";
import { canControlPreview } from "../../preview/preview-state";
import { PreviewNotice } from "../workspace-shell";

const displayed = {
  channel: "dev" as const,
  requestId: "previous",
  buildIdentity: "previous-build",
  sourceRevision: "previous-revision",
};
const render = (state: Partial<PreviewSnapshot>) =>
  renderToStaticMarkup(
    createElement(PreviewNotice, {
      view: { ...createPreviewStore().getState(), ...state },
      reload() {},
    }),
  );
it("shows the preparation screen only before the first picture", () => {
  const html = render({ status: "loading", phase: "preparing" });
  expect(html).toContain("Unity Preview を準備しています…");
  expect(html).not.toContain("preview-notice-compact");
  expect(html).toContain('role="status"');
});
it.each<[PreviewPhase, string]>([
  ["pending", "更新待ち"],
  ["building", "ビルド中"],
  ["preparing", "表示反映中"],
  ["committing", "表示反映中"],
  ["confirming", "表示反映中"],
])("shows a compact %s indicator over an existing picture", (phase, label) => {
  const html = render({ displayed, status: "loading", phase });
  expect(html).toContain("preview-notice-compact");
  expect(html).toContain(label);
  expect(html).not.toContain("準備しています");
  expect(html).not.toContain('role="alert"');
});
it("keeps a failed update compact and offers a retry", () => {
  const html = render({ displayed, status: "error", phase: "failed", error: "Build failed" });
  expect(html).toContain("preview-notice-compact");
  expect(html).toContain('role="alert"');
  expect(html).toContain("更新失敗");
  expect(html).toContain("再試行");
});
it("does not activate controls for a retained picture", () => {
  const state = { ...createPreviewStore().getState(), displayed };
  expect(canControlPreview(state)).toBe(false);
  expect(canControlPreview({ ...state, status: "loading", phase: "pending" })).toBe(false);
  expect(canControlPreview({ ...state, status: "error", phase: "failed" })).toBe(false);
});
it("removes the indicator after the new picture is ready", () => {
  expect(render({ displayed, loaded: displayed, status: "ready", phase: "ready" })).toBe("");
});

it("shows build progress and update failures while the previous preview is still controllable", () => {
  expect(render({ displayed, loaded: displayed, status: "ready", phase: "building" })).toContain(
    "ビルド中",
  );
  const html = render({
    displayed,
    loaded: displayed,
    status: "ready",
    phase: "failed",
    error: "Recovery required",
  });
  expect(html).toContain("更新失敗");
  expect(html).toContain("再試行");
});
