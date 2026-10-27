import { createStore } from "zustand/vanilla";
import type { Theme } from "../ui/theme";
export type FlowSelection = { groupId: string | null; stepId: string | null; cueId: string | null };
export type KeySelection = {
  timelineId: string;
  nodeId: string;
  property: string;
  time: number;
  value: string;
  easing: string;
};
export type UiState = {
  theme: Theme;
  compact: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  publicationOpen: boolean;
  tab: "timeline" | "flow" | "diagnostics";
  selection: FlowSelection;
  key: KeySelection | null;
};
export const createUiStore = (theme: Theme) =>
  createStore<UiState>(() => ({
    theme,
    compact: false,
    leftOpen: true,
    rightOpen: true,
    publicationOpen: false,
    tab: "timeline",
    selection: { groupId: null, stepId: null, cueId: null },
    key: null,
  }));
