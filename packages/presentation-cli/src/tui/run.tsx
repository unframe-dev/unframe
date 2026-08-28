import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { KeymapProvider, useBindings } from "@opentui/keymap/solid";
import { render } from "@opentui/solid";
import { createEffect, createSignal } from "solid-js";

import {
  initialPresentationTuiState,
  reducePresentationTuiState,
  type PresentationTuiAction,
  type PresentationTuiCommandId,
} from "./model.js";
import { PresentationTuiView } from "./view.js";

export type RunPresentationTuiOptions = Readonly<{
  onCommandSelected?: (command: PresentationTuiCommandId) => void;
}>;

type PresentationTuiAppProps = RunPresentationTuiOptions &
  Readonly<{
    renderer: CliRenderer;
  }>;

const PresentationTuiApp = (props: PresentationTuiAppProps) => {
  const [state, setState] = createSignal(initialPresentationTuiState);
  const dispatch = (action: PresentationTuiAction) => {
    setState((current) => reducePresentationTuiState(current, action));
  };

  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => dispatch({ type: "previous" }) },
      { key: "k", cmd: () => dispatch({ type: "previous" }) },
      { key: "down", cmd: () => dispatch({ type: "next" }) },
      { key: "j", cmd: () => dispatch({ type: "next" }) },
      { key: "enter", cmd: () => dispatch({ type: "select" }) },
      { key: "q", cmd: () => dispatch({ type: "quit" }) },
      { key: "escape", cmd: () => dispatch({ type: "quit" }) },
      { key: "ctrl+c", cmd: () => dispatch({ type: "quit" }) },
    ],
  }));

  createEffect(() => {
    const effect = state().effect;
    if (!effect) return;
    if (effect.type === "command-selected") props.onCommandSelected?.(effect.command);
    if (effect.type === "quit") props.renderer.destroy();
    dispatch({ type: "effect-handled" });
  });

  return <PresentationTuiView state={state()} />;
};

export const runPresentationTui = async (options: RunPresentationTuiOptions = {}) => {
  if (!("Bun" in globalThis)) throw new Error("Presentation TUI requires the Bun runtime.");

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
  });
  const keymap = createDefaultOpenTuiKeymap(renderer);

  await render(
    () => (
      <KeymapProvider keymap={keymap}>
        <PresentationTuiApp renderer={renderer} {...options} />
      </KeymapProvider>
    ),
    renderer,
  );
};
