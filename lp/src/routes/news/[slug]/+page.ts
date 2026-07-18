import { error } from "@sveltejs/kit";
import { newsEntries } from "$lib/content";

export const entries = () => newsEntries.map(({ slug }) => ({ slug }));

export function load({ params }: { params: { slug: string } }) {
  const entry = newsEntries.find((candidate) => candidate.slug === params.slug);
  if (!entry) {
    error(404, "News item not found");
  }

  return { slug: entry.slug };
}
