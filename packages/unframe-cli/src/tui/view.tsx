import { For } from "solid-js";

import { presentationTuiCommands, type PresentationTuiState } from "./model.js";

export type PresentationTuiViewProps = Readonly<{
  state: PresentationTuiState;
}>;

export const PresentationTuiView = (props: PresentationTuiViewProps) => (
  <box border borderColor="#5eead4" flexDirection="column" padding={1}>
    <text fg="#5eead4">Unframe Presentation</text>
    <text fg="#94a3b8">Choose an authoring workflow.</text>
    <box flexDirection="column" marginTop={1}>
      <For each={presentationTuiCommands}>
        {(command, index) => {
          const selected = () => index() === props.state.selectedIndex;
          return (
            <box flexDirection="column" marginBottom={1}>
              <text fg={selected() ? "#f8fafc" : "#94a3b8"}>
                {`${selected() ? ">" : " "} ${command.label}`}
              </text>
              <text fg="#64748b">{`  ${command.description}`}</text>
            </box>
          );
        }}
      </For>
    </box>
    <text fg="#94a3b8">↑/↓ navigate • Enter select • q quit</text>
  </box>
);
