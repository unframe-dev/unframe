import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { getPresentation, getPublication, listPresentations } from "./management-api";

const staleTime = 60_000;
export const presentationKeys = {
  all: ["presentations"] as const,
  list: ["presentations", "list"] as const,
  detail: (id: string) => ["presentations", "detail", id] as const,
  publication: (id: string) => ["presentations", "detail", id, "publication"] as const,
};

export function presentationsQueryOptions(client: QueryClient) {
  return queryOptions({
    queryKey: presentationKeys.list,
    queryFn: async ({ signal }) => {
      const presentations = await listPresentations(signal);
      signal.throwIfAborted();
      for (const presentation of presentations) {
        client.setQueryData(presentationKeys.detail(presentation.id), presentation);
      }
      return presentations;
    },
    staleTime,
    retry: false,
  });
}

export function presentationQueryOptions(id: string) {
  return queryOptions({
    queryKey: presentationKeys.detail(id),
    queryFn: ({ signal }) => getPresentation(id, signal),
    staleTime,
    retry: false,
    enabled: Boolean(id),
  });
}

let activePublications = 0;
const waitingPublications: (() => void)[] = [];

async function loadPublication(id: string, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      activePublications++;
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      const index = waitingPublications.indexOf(start);
      if (index >= 0) waitingPublications.splice(index, 1);
      reject(signal.reason);
    };
    if (activePublications < 3) start();
    else {
      waitingPublications.push(start);
      signal.addEventListener("abort", abort, { once: true });
    }
  });
  try {
    signal.throwIfAborted();
    return await getPublication(id, signal);
  } finally {
    activePublications--;
    waitingPublications.shift()?.();
  }
}

export function publicationQueryOptions(id: string) {
  return queryOptions({
    queryKey: presentationKeys.publication(id),
    queryFn: ({ signal }) => loadPublication(id, signal),
    staleTime,
    retry: false,
    enabled: Boolean(id),
  });
}
