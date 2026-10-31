import { createPublicationClient } from "@unframe/api-client-typescript/publication";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPublicationController } from "./publication-controller";

const PublicationContext = createContext<ReturnType<typeof createPublicationController> | null>(
  null,
);

export function PublicationWorkflowProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() =>
    createPublicationController(
      createPublicationClient({
        baseUrl: import.meta.env["VITE_CONTROL_PLANE_URL"] || "https://api.un-fra.me",
        credentials: "include",
      }),
    ),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const queries = useQueryClient();
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (state.status !== "published") return;
    void queries.invalidateQueries({ queryKey: ["presentations"] });
    void queries.invalidateQueries({ queryKey: ["publications"] });
    void queries.invalidateQueries({
      queryKey: ["presentation", state.selection.dist.artifacts.buildManifest.presentationId],
    });
  }, [state, queries]);
  return <PublicationContext value={controller}>{children}</PublicationContext>;
}

export function usePublicationController() {
  const controller = useContext(PublicationContext);
  if (!controller) throw new Error("Publication workflow provider is missing");
  return controller;
}
