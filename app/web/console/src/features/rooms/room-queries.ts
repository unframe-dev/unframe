import type { QueryClient } from "@tanstack/react-query";

const details = ["room"] as const;
export const roomKeys = {
  details,
  detail: (id: string) => [...details, id] as const,
  code: (id: string) => ["room-code", id] as const,
  runtimePreparation: (id: string) => ["runtime-preparation", id] as const,
  owned: ["owned-rooms"] as const,
};

export function removeRoomQueries(client: QueryClient, id: string) {
  client.removeQueries({ queryKey: roomKeys.detail(id) });
  client.removeQueries({ queryKey: roomKeys.code(id) });
  client.removeQueries({ queryKey: roomKeys.runtimePreparation(id) });
}
