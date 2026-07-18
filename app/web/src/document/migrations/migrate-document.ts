import { z } from "zod";
import { AssetReferenceSchema } from "../schema/asset";
import {
  PresentationDocumentSchema,
  type PresentationDocument,
} from "../schema/presentation-document";
import { SlideSchema } from "../schema/slide";

const LegacyPresentationDocumentSchema = z.object({
  version: z.literal(0),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  title: z.string().min(1),
  slides: z.array(SlideSchema).min(1),
  assets: z.array(AssetReferenceSchema),
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

  if (version === 1) return PresentationDocumentSchema.parse(input);

  if (version === 0) {
    const legacy = LegacyPresentationDocumentSchema.parse(input);
    return PresentationDocumentSchema.parse({
      version: 1,
      id: legacy.id,
      revision: legacy.revision,
      metadata: { title: legacy.title },
      slides: legacy.slides,
      assets: legacy.assets,
    });
  }

  throw new UnsupportedDocumentVersionError(version);
}
