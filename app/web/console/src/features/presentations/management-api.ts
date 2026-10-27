import { createControlPlaneClient } from "@unframe/api-client-typescript";
import {
  publicationFenceSchema,
  publishedPresentationSchema,
} from "@unframe/contracts/presentation";
import { z } from "zod";
import { ManagementError, mapConcurrent } from "./management-model";

const client = createControlPlaneClient({
  baseUrl: import.meta.env["VITE_CONTROL_PLANE_URL"] || "https://api.un-fra.me",
  credentials: "include",
});
const presentationSchema = z.object({ id: z.string(), name: z.string() });
const sessionSchema = z.object({
  id: z.string(),
  presentationId: z.string(),
  state: z.enum(["Waiting", "Presenting", "Ended"]),
  publicationFence: publicationFenceSchema.nullable(),
});
export type Presentation = z.infer<typeof presentationSchema>;
export type Publication = z.infer<typeof publishedPresentationSchema>;
export type Room = z.infer<typeof sessionSchema>;
export type PublicationResult = { presentation: Presentation } & (
  | { state: "published"; publication: Publication }
  | { state: "unpublished" }
  | { state: "error"; error: unknown }
);

async function readJson(response: Pick<Response, "ok" | "status" | "json">): Promise<unknown> {
  if (!response.ok) throw new ManagementError(response.status);
  return response.json();
}
export async function listPresentations() {
  const response = await client.presentations.$get();
  return z.object({ presentations: z.array(presentationSchema) }).parse(await readJson(response))
    .presentations;
}
export async function getPresentation(id: string, signal?: AbortSignal) {
  return presentationSchema.parse(
    await readJson(
      await client.presentations[":id"].$get(
        { param: { id } },
        { init: { signal: signal ?? null } },
      ),
    ),
  );
}
export async function getPublication(
  presentationId: string,
  signal?: AbortSignal,
): Promise<Publication | null> {
  const response = await client.presentations[":presentationId"].publication.$get(
    { param: { presentationId } },
    { init: { signal: signal ?? null } },
  );
  if (response.status === 404) {
    await getPresentation(presentationId, signal);
    return null;
  }
  return publishedPresentationSchema.parse(await readJson(response));
}
export async function loadPublications(
  presentations: Presentation[],
  signal?: AbortSignal,
): Promise<PublicationResult[]> {
  return mapConcurrent(presentations, 3, async (presentation) => {
    try {
      signal?.throwIfAborted();
      const publication = await getPublication(presentation.id, signal);
      return publication
        ? { presentation, state: "published", publication }
        : { presentation, state: "unpublished" };
    } catch (error) {
      return { presentation, state: "error", error };
    }
  });
}
export async function createRoom(presentationId: string) {
  return z
    .object({ session: sessionSchema, joinCode: z.string() })
    .parse(await readJson(await client.sessions.$post({ json: { presentationId } })));
}
export async function getRoom(id: string) {
  return sessionSchema.parse(await readJson(await client.sessions[":id"].$get({ param: { id } })));
}
