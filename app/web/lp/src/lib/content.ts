import type { Component } from "svelte";
import { buildContentRegistry, type ContentEntry, type ContentModule } from "./content-registry";

type ContentComponent = Component;
type ContentFile = ContentModule<ContentComponent>;

const newsModules = import.meta.glob("/src/content/news/*.mdx", { eager: true }) as Record<
  string,
  ContentFile
>;
const docsModules = import.meta.glob("/src/content/docs/*.mdx", { eager: true }) as Record<
  string,
  ContentFile
>;

export const newsEntries: ContentEntry<ContentComponent>[] = buildContentRegistry(newsModules);
export const docsEntries: ContentEntry<ContentComponent>[] = buildContentRegistry(docsModules);
