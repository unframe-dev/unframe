import { z } from "zod";
import { AssetReferenceSchema } from "./asset";
import { PresentationDocumentSchema, type PresentationDocument } from "./presentation-document";
import { SlideSchema } from "./slide";

const LegacyPresentationDocumentSchema = z.object({
  assets: z.array(AssetReferenceSchema),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  slides: z.array(SlideSchema).min(1),
  title: z.string().min(1),
  version: z.literal(0),
});

export class UnsupportedDocumentVersionError extends Error {
  constructor(readonly version: unknown) {
    super(`Unsupported presentation document version: ${String(version)}`);
    this.name = "UnsupportedDocumentVersionError";
  }
}

function readVersion(input: unknown): unknown {
  if (typeof input !== "object" || input === null || !("version" in input)) {
    return undefined;
  }
  return input.version;
}

export function migrateDocument(input: unknown): PresentationDocument {
  const version = readVersion(input);

  if (version === 1) {
    return PresentationDocumentSchema.parse(input);
  }

  if (version === 0) {
    const legacy = LegacyPresentationDocumentSchema.parse(input);
    return PresentationDocumentSchema.parse({
      assets: legacy.assets,
      id: legacy.id,
      metadata: { title: legacy.title },
      revision: legacy.revision,
      slides: legacy.slides,
      version: 1,
    });
  }

  throw new UnsupportedDocumentVersionError(version);
}
