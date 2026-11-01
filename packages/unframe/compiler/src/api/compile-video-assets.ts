import { z } from "zod";
import type { VideoMetadata } from "@unframe/core/assets";
import type { ValidationResult } from "@unframe/presentation";
import type {
  CompilerSourceAsset,
  CompilerSourceAssetBytes,
  CompilerVideoValidator,
} from "./types.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { diagnosticSchema } from "../validation/project-schemas.js";

const metadataSchema = z.strictObject({
  mediaType: z.literal("video/mp4"),
  codec: z.literal("h264"),
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  encodedSizeBytes: z.number().int().nonnegative().safe(),
  durationMilliseconds: z.number().int().positive().safe(),
  pixelSize: z.tuple([
    z.number().int().positive().max(4096),
    z.number().int().positive().max(4096),
  ]),
  alpha: z.literal(false),
  audio: z.boolean(),
  requiredFeatures: z.array(z.enum(["h264", "audio"])),
});
export const compileVideoAssets = async (
  assets: Readonly<Record<string, CompilerSourceAsset>>,
  bytes: CompilerSourceAssetBytes,
  validator: CompilerVideoValidator | undefined,
): Promise<ValidationResult<Record<string, VideoMetadata>>> => {
  const metadata: Record<string, VideoMetadata> = {};
  for (const [id, asset] of Object.entries(assets)) {
    if (asset.mediaType !== "video/mp4") continue;
    const invalid = (code: string, message: string): ValidationResult<never> => ({
      valid: false,
      diagnostics: [{ code, path: ["assets", id], message }],
    });
    if (!validator)
      return invalid(
        "compiler-video-validator-required",
        "Video compilation requires a host validator.",
      );
    let output: unknown;
    try {
      output = await validator.validate({
        sourceId: id,
        bytes: bytes[id]!.slice(),
        checksum: asset.checksum,
        encodedSizeBytes: asset.encodedSizeBytes,
      });
    } catch {
      return invalid("compiler-video-validation-failed", "Video validation failed.");
    }
    const snapshot = safePlainClone(output);
    if (!snapshot.valid)
      return invalid(
        "compiler-video-metadata-invalid",
        "Video metadata must be plain validated data.",
      );
    const result = z
      .discriminatedUnion("valid", [
        z.strictObject({ valid: z.literal(true), value: metadataSchema, diagnostics: z.tuple([]) }),
        z.strictObject({ valid: z.literal(false), diagnostics: z.array(diagnosticSchema).min(1) }),
      ])
      .safeParse(snapshot.value);
    if (!result.success)
      return invalid("compiler-video-metadata-invalid", "Video metadata has an invalid shape.");
    if (!result.data.valid)
      return {
        valid: false,
        diagnostics: result.data.diagnostics.map((item) => ({
          code: item.code,
          message: item.message,
          path: ["assets", id, ...item.path],
          ...(item.relatedPath ? { relatedPath: item.relatedPath } : {}),
        })),
      };
    const measured = result.data.value;
    if (
      measured.checksum !== asset.checksum ||
      measured.encodedSizeBytes !== asset.encodedSizeBytes ||
      measured.requiredFeatures.join(",") !== (measured.audio ? "h264,audio" : "h264") ||
      Math.ceil(measured.pixelSize[0] / 16) * Math.ceil(measured.pixelSize[1] / 16) > 8192
    )
      return invalid(
        "compiler-video-metadata-invalid",
        "Video metadata must match the validated source and profile.",
      );
    metadata[id] = measured;
  }
  return { valid: true, value: metadata, diagnostics: [] };
};
