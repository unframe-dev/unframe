export type PresentationTuiCommandId = "build" | "check";

export type PresentationTuiCommand = Readonly<{
  id: PresentationTuiCommandId;
  label: string;
  description: string;
}>;

export const presentationTuiCommands: readonly PresentationTuiCommand[] = Object.freeze([
  Object.freeze({
    id: "check",
    label: "Check presentation",
    description: "Validate an authoring project without rendering artifacts.",
  }),
  Object.freeze({
    id: "build",
    label: "Build presentation",
    description: "Compile and render a complete artifact set.",
  }),
]);

export type PresentationTuiEffect =
  | Readonly<{ type: "command-selected"; command: PresentationTuiCommandId }>
  | Readonly<{ type: "quit" }>;

export type PresentationTuiState = Readonly<{
  selectedIndex: number;
  effect?: PresentationTuiEffect;
}>;

export type PresentationTuiAction = Readonly<{
  type: "effect-handled" | "next" | "previous" | "quit" | "select";
}>;

export const initialPresentationTuiState: PresentationTuiState = Object.freeze({
  selectedIndex: 0,
});

export const reducePresentationTuiState = (
  state: PresentationTuiState,
  action: PresentationTuiAction,
): PresentationTuiState => {
  switch (action.type) {
    case "next":
      return Object.freeze({
        selectedIndex: (state.selectedIndex + 1) % presentationTuiCommands.length,
      });
    case "previous":
      return Object.freeze({
        selectedIndex:
          (state.selectedIndex + presentationTuiCommands.length - 1) %
          presentationTuiCommands.length,
      });
    case "select":
      return Object.freeze({
        selectedIndex: state.selectedIndex,
        effect: Object.freeze({
          type: "command-selected",
          command: presentationTuiCommands[state.selectedIndex]?.id ?? "check",
        }),
      });
    case "quit":
      return Object.freeze({
        selectedIndex: state.selectedIndex,
        effect: Object.freeze({ type: "quit" }),
      });
    case "effect-handled":
      return Object.freeze({ selectedIndex: state.selectedIndex });
  }
};
