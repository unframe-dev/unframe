import { error } from "@sveltejs/kit";
import { blogEntries } from "$lib/content";

export const entries = () => blogEntries.map(({ slug }) => ({ slug }));

export function load({ params }: { params: { slug: string } }) {
  const entry = blogEntries.find((candidate) => candidate.slug === params.slug);
  if (!entry) {
    error(404, "Blog post not found");
  }

  return { slug: entry.slug };
}
