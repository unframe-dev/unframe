import type { createUiStore } from "./ui-store";

type ViewportMedia = {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};
export function connectViewportLayout(ui: ReturnType<typeof createUiStore>, media: ViewportMedia) {
  const update = () => {
    if (ui.getState().compact === media.matches) return;
    ui.setState({
      compact: media.matches,
      ...(media.matches ? { leftOpen: false, rightOpen: false } : {}),
    });
  };
  update();
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
