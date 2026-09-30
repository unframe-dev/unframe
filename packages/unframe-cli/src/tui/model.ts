export type PresentationTuiCommandId = "build" | "check";

export type PresentationTuiCommand = Readonly<{
  description: string;
  id: PresentationTuiCommandId;
  label: string;
}>;

export const presentationTuiCommands: ReadonlyArray<PresentationTuiCommand> = Object.freeze([
  Object.freeze({
    description: "Validate an authoring project without rendering artifacts.",
    id: "check",
    label: "Check presentation",
  }),
  Object.freeze({
    description: "Compile and render a complete artifact set.",
    id: "build",
    label: "Build presentation",
  }),
]);

export type PresentationTuiEffect =
  | Readonly<{ command: PresentationTuiCommandId; type: "command-selected" }>
  | Readonly<{ type: "quit" }>;

export type PresentationTuiState = Readonly<{
  effect?: PresentationTuiEffect;
  selectedIndex: number;
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
        effect: Object.freeze({
          command: presentationTuiCommands[state.selectedIndex]?.id ?? "check",
          type: "command-selected",
        }),
        selectedIndex: state.selectedIndex,
      });
    case "quit":
      return Object.freeze({
        effect: Object.freeze({ type: "quit" }),
        selectedIndex: state.selectedIndex,
      });
    case "effect-handled":
      return Object.freeze({ selectedIndex: state.selectedIndex });
  }
};
