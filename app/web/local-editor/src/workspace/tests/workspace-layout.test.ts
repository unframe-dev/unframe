import { expect, it } from "vite-plus/test";
import { createUiStore } from "../ui-store";
import { connectViewportLayout } from "../workspace-layout";

it("keeps opened compact panels when the viewport effect reconnects", () => {
  const ui = createUiStore("light");
  const media = Object.assign(new EventTarget(), { matches: true });
  const disconnect = connectViewportLayout(ui, media);
  expect(ui.getState()).toMatchObject({ compact: true, leftOpen: false, rightOpen: false });
  ui.setState({ leftOpen: true, rightOpen: true });
  disconnect();
  const reconnected = connectViewportLayout(ui, media);
  expect(ui.getState()).toMatchObject({ compact: true, leftOpen: true, rightOpen: true });
  media.dispatchEvent(new Event("change"));
  expect(ui.getState()).toMatchObject({ leftOpen: true, rightOpen: true });
  reconnected();
});
it("closes panels on entry into compact layout and preserves them on exit", () => {
  const ui = createUiStore("light");
  const media = Object.assign(new EventTarget(), { matches: false });
  const disconnect = connectViewportLayout(ui, media);
  expect(ui.getState()).toMatchObject({ compact: false, leftOpen: true, rightOpen: true });
  media.matches = true;
  media.dispatchEvent(new Event("change"));
  expect(ui.getState()).toMatchObject({ compact: true, leftOpen: false, rightOpen: false });
  ui.setState({ leftOpen: true });
  media.matches = false;
  media.dispatchEvent(new Event("change"));
  expect(ui.getState()).toMatchObject({ compact: false, leftOpen: true, rightOpen: false });
  media.matches = true;
  media.dispatchEvent(new Event("change"));
  expect(ui.getState()).toMatchObject({ compact: true, leftOpen: false, rightOpen: false });
  disconnect();
});
it("stops observing viewport changes after disconnect", () => {
  const ui = createUiStore("light");
  const media = Object.assign(new EventTarget(), { matches: false });
  const disconnect = connectViewportLayout(ui, media);
  disconnect();
  media.matches = true;
  media.dispatchEvent(new Event("change"));
  expect(ui.getState()).toMatchObject({ compact: false, leftOpen: true, rightOpen: true });
});
