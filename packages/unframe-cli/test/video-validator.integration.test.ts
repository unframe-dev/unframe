import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createVideoValidator } from "../src/media/video-validator.js";

it("fully decodes the pinned H264/AAC fixture in the isolated media worker", async () => {
  const bytes = new Uint8Array(
    await readFile(new URL("../fixtures/media-presentation/assets/video.mp4", import.meta.url)),
  );
  const validator = await createVideoValidator();
  const result = await validator.validate({
    sourceId: "fixture",
    bytes,
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    encodedSizeBytes: bytes.length,
  });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  expect(result).toMatchObject({
    valid: true,
    value: {
      durationMilliseconds: 6000,
      pixelSize: [320, 180],
      codec: "h264",
      audio: true,
      alpha: false,
      checksum: "sha256:c680a9ea08919f4da4189d6d88da18394408f4bf965648aed45928dc0c53fb64",
    },
  });
}, 120_000);

it.each([
  ["VideoAudioTail", 2000, true],
  ["VideoShortAudio", 1000, true],
  ["VideoSilent", 1000, false],
] as const)(
  "uses the full movie presentation duration for %s",
  async (name, duration, audio) => {
    const bytes = new Uint8Array(
      await readFile(
        new URL(
          `../../../app/unity/Assets/Tests/EditMode/Editor/FixturesData/${name}.bytes`,
          import.meta.url,
        ),
      ),
    );
    const validator = await createVideoValidator();
    const result = await validator.validate({
      sourceId: name,
      bytes,
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      encodedSizeBytes: bytes.length,
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(result).toMatchObject({
      valid: true,
      value: { durationMilliseconds: duration, pixelSize: [320, 180], audio },
    });
  },
  120_000,
);
