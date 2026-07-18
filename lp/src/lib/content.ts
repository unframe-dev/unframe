import type { Component } from "svelte";
import { buildContentRegistry, type ContentEntry, type ContentModule } from "./content-registry";

type ContentComponent = Component;
type ContentFile = ContentModule<ContentComponent>;

const blogModules = import.meta.glob("/src/content/blog/*.mdx", { eager: true }) as Record<
  string,
  ContentFile
>;
const docsModules = import.meta.glob("/src/content/docs/*.mdx", { eager: true }) as Record<
  string,
  ContentFile
>;

export const blogEntries: ContentEntry<ContentComponent>[] = buildContentRegistry(blogModules);
export const docsEntries: ContentEntry<ContentComponent>[] = buildContentRegistry(docsModules);
