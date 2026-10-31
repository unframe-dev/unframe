import { error } from "@sveltejs/kit";
import { docsEntries } from "$lib/content";

export const entries = () => docsEntries.map(({ slug }) => ({ slug }));

export function load({ params }: { params: { slug: string } }) {
  const entry = docsEntries.find((candidate) => candidate.slug === params.slug);
  if (!entry) {
    error(404, "Document not found");
  }

  return { slug: entry.slug };
}
