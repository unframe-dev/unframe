export type ContentMetadata = {
  title: string;
  description: string;
  order: number;
  publishedAt?: string;
};

type ContentModuleMetadata = Omit<ContentMetadata, "description"> & {
  description?: string;
};

export type ContentModule<TComponent = unknown> = {
  default: TComponent;
  metadata: ContentModuleMetadata;
};

export type ContentEntry<TComponent = unknown> = ContentMetadata & {
  slug: string;
  component: TComponent;
};

export function buildContentRegistry<TComponent>(
  modules: Record<string, ContentModule<TComponent>>,
): ContentEntry<TComponent>[] {
  const entries = Object.entries(modules).map(([path, module]) => {
    const extension = path.endsWith(".mdx") ? ".mdx" : path.endsWith(".md") ? ".md" : undefined;
    if (!extension) {
      throw new Error(`Unsupported content file: ${path}. Only Markdown or MDX files are supported.`);
    }

    const metadata = module.metadata;
    if (!metadata || typeof metadata.title !== "string" || typeof metadata.description !== "string") {
      throw new Error(`Content metadata for ${path} must include title and description.`);
    }
    if (typeof metadata.order !== "number" || !Number.isFinite(metadata.order)) {
      throw new Error(`Content metadata for ${path} must include a numeric order.`);
    }

    const filename = path.split("/").at(-1) ?? "";
    return {
      title: metadata.title,
      description: metadata.description,
      order: metadata.order,
      ...(metadata.publishedAt ? { publishedAt: metadata.publishedAt } : {}),
      slug: filename.slice(0, -extension.length),
      component: module.default,
    };
  });

  const seenSlugs = new Set<string>();
  for (const entry of entries) {
    if (seenSlugs.has(entry.slug)) {
      throw new Error(`Found duplicate slug: ${entry.slug}`);
    }
    seenSlugs.add(entry.slug);
  }

  return entries.sort((a, b) => a.order - b.order);
}
