import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import * as z from "zod";

import {
  assetSetManifestSchema,
  buildManifestSchema,
  capabilityProfileSchema,
  canonicalRuntimeSnapshotSchema,
  participantRuntimeViewSchema,
  presentationDefinitionSchema,
  publishedPresentationSchema,
  renderBundleSchema,
} from "../src/presentation/index";

const root = resolve(import.meta.dirname, "../presentation");
const schemas: ReadonlyArray<readonly [string, z.ZodType]> = [
  ["presentation-definition", presentationDefinitionSchema],
  ["render-bundle", renderBundleSchema],
  ["asset-set-manifest", assetSetManifestSchema],
  ["build-manifest", buildManifestSchema],
  ["published-presentation", publishedPresentationSchema],
  ["capability-profile", capabilityProfileSchema],
];
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const fixture = async (name: string) =>
  JSON.parse(await readFile(resolve(root, "fixtures", `${name}.json`), "utf8"));

for (const [name, schema] of schemas) {
  const jsonSchema = JSON.parse(await readFile(resolve(root, `${name}.schema.json`), "utf8"));
  const validate = ajv.compile(jsonSchema);
  const sample = await fixture(name);
  test(`${name}: Zod and portable JSON Schema accept the complete fixture`, () => {
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, result.success ? undefined : result.error.message);
    assert.equal(validate(sample), true, ajv.errorsText(validate.errors));
  });
  test(`${name}: both schemas reject wrong major and unknown transport fields`, () => {
    for (const invalid of [
      { ...sample, schemaVersion: 1 },
      { ...sample, sessionId: "session" },
    ]) {
      assert.equal(schema.safeParse(invalid).success, false);
      assert.equal(validate(invalid), false);
    }
  });
}

const definition = await fixture("presentation-definition");
const validateDefinition = ajv.getSchema(
  "https://contracts.unframe.dev/presentation/presentation-definition.schema.json",
)!;
const bundle = await fixture("render-bundle");
const partialSnapshot = await fixture("m3d-cue-runtime-snapshot");
const partialView = await fixture("m3d-cue-participant-runtime-view");
test("full Runtime schemas retain Media and Model state across Zod and JSON Schema", async () => {
  const snapshot = {
    ...partialSnapshot,
    mediaStates: { video: { kind: "stopped", heldPositionMilliseconds: 0 } },
    modelClipStates: { model: { kind: "defaultPose" } },
  };
  const view = {
    ...partialView,
    mediaStates: snapshot.mediaStates,
    modelClipStates: snapshot.modelClipStates,
  };
  for (const [name, schema, sample] of [
    ["canonical-runtime-snapshot", canonicalRuntimeSnapshotSchema, snapshot],
    ["participant-runtime-view", participantRuntimeViewSchema, view],
  ] as const) {
    const jsonSchema = JSON.parse(await readFile(resolve(root, `${name}.schema.json`), "utf8"));
    const validate = ajv.compile(jsonSchema);
    assert.equal(schema.safeParse(sample).success, true);
    assert.equal(validate(sample), true, ajv.errorsText(validate.errors));
  }
});
const validateBundle = ajv.getSchema(
  "https://contracts.unframe.dev/presentation/render-bundle.schema.json",
)!;

test("RenderSurface requires the supported partition strategy version", () => {
  const supported = structuredClone(bundle);
  supported.surfaces.baked.renderSurfaces["render-baked"].partitionStrategyVersion = 1;
  assert.equal(renderBundleSchema.safeParse(supported).success, true);
  assert.equal(validateBundle(supported), true);
  for (const version of [undefined, 0, 2]) {
    const invalid = structuredClone(bundle);
    const partition = invalid.surfaces.baked.renderSurfaces["render-baked"];
    if (version === undefined) delete partition.partitionStrategyVersion;
    else partition.partitionStrategyVersion = version;
    assert.equal(renderBundleSchema.safeParse(invalid).success, false);
    assert.equal(validateBundle(invalid), false);
  }
});

function rejectsDefinition(change: (value: typeof definition) => void): void {
  const invalid = structuredClone(definition);
  change(invalid);
  assert.equal(presentationDefinitionSchema.safeParse(invalid).success, false);
  assert.equal(validateDefinition(invalid), false);
}

test("scope excludes WebView, standalone audio and animation layers", () => {
  for (const kind of ["embedded-web", "audio"]) {
    rejectsDefinition((value) => {
      value.scene.nodes.model = { ...value.scene.nodes.model, kind };
    });
  }
  rejectsDefinition((value) => {
    value.flow.groups.intro.steps.start.cues[0].actions[0].layers = [];
  });
  rejectsDefinition((value) => {
    value.scene.surfaces.baked.renderIntent.rendererPreference = "embedded-web";
  });
});

test("Surface content is structured or opaque with no portable source code", () => {
  const opaque = structuredClone(definition);
  opaque.scene.surfaces.baked.content = {
    kind: "opaque",
    bindings: { label: "label" },
  };
  assert.equal(presentationDefinitionSchema.safeParse(opaque).success, true);
  assert.equal(validateDefinition(opaque), true, ajv.errorsText(validateDefinition.errors));
  for (const extra of [{ source: "export default function Surface() {}" }, { nodes: {} }]) {
    const invalid = structuredClone(opaque);
    Object.assign(invalid.scene.surfaces.baked.content, extra);
    assert.equal(presentationDefinitionSchema.safeParse(invalid).success, false);
    assert.equal(validateDefinition(invalid), false);
  }
  rejectsDefinition((value) => {
    value.scene.surfaces.baked.rootFrameId = "root";
  });
});

test("state patches cannot replace topology or video identity", () => {
  for (const property of ["parentId", "children", "order"]) {
    rejectsDefinition((value) => {
      value.scene.surfaces.baked.states.default.contentOverrides.root = {
        kind: "frame",
        [property]: property === "children" ? [] : 0,
      };
    });
  }
  rejectsDefinition((value) => {
    value.scene.surfaces.video.states.default.contentOverrides.video = {
      kind: "video",
      assetId: "another-video",
    };
  });
});

test("Video State may override playback loop without replacing its asset", () => {
  const valid = structuredClone(definition);
  valid.scene.surfaces.video.states.default.contentOverrides.video = { kind: "video", loop: true };
  assert.equal(presentationDefinitionSchema.safeParse(valid).success, true);
  assert.equal(validateDefinition(valid), true, ajv.errorsText(validateDefinition.errors));
  rejectsDefinition((value) => {
    value.scene.surfaces.video.states.default.contentOverrides.video = {
      kind: "video",
      assetId: "another-video",
      loop: true,
    };
  });
});

test("clip controls require positive speed and typed transition", () => {
  for (const speed of [0, -1]) {
    rejectsDefinition((value) => {
      value.flow.groups.intro.steps.start.cues[0].actions[0].speed = speed;
    });
  }
  rejectsDefinition((value) => {
    value.flow.groups.intro.steps.start.cues[0].actions[0].transition = {
      kind: "crossfade",
      durationMilliseconds: 0,
      easing: "linear",
    };
  });
});

test("nested guard rejects arbitrary payloads", () => {
  rejectsDefinition((value) => {
    value.flow.groups.intro.steps.start.cues[0].guard = {
      kind: "all",
      guards: [{ kind: "not", guard: { kind: "script", body: "true" } }],
    };
  });
});

test("asset set rejects self hash, external paths and unsafe byte counts", async () => {
  const manifest = await fixture("asset-set-manifest");
  for (const extra of [
    { assetSetHash: `sha256:${"a".repeat(64)}` },
    { url: "https://example.com" },
  ]) {
    assert.equal(assetSetManifestSchema.safeParse({ ...manifest, ...extra }).success, false);
  }
  for (const bytes of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(manifest);
    invalid.assets.image.encodedSizeBytes = bytes;
    assert.equal(assetSetManifestSchema.safeParse(invalid).success, false);
  }
});

test("render artifacts reject runtime code and malformed texture tuples", () => {
  for (const patch of [{ script: "run()" }, { kind: "embedded-web" }]) {
    const invalid = structuredClone(bundle);
    Object.assign(
      invalid.surfaces.baked.renderSurfaces["render-baked"].artifacts["artifact-baked"],
      patch,
    );
    assert.equal(renderBundleSchema.safeParse(invalid).success, false);
    assert.equal(validateBundle(invalid), false);
  }
  const invalid = structuredClone(bundle);
  invalid.surfaces.baked.renderSurfaces["render-baked"].artifacts[
    "artifact-baked"
  ].states.default.texture.pixelSize.push(1);
  assert.equal(renderBundleSchema.safeParse(invalid).success, false);
  assert.equal(validateBundle(invalid), false);
});

test("all four resource budgets are mandatory", async () => {
  const profile = await fixture("capability-profile");
  for (const renderer of ["texture", "nativeUi", "video", "model"]) {
    const invalid = structuredClone(profile);
    delete invalid.limits[renderer];
    assert.equal(capabilityProfileSchema.safeParse(invalid).success, false);
  }
});

for (const [file, message] of [
  ["held-model-blend", "unframe.realtime.ModelClipRuntimeState"],
  ["paused-model-crossfade", "unframe.realtime.ModelClipRunSnapshot"],
  ["paused-crossfade-held-source", "unframe.realtime.ModelClipRunSnapshot"],
  ["null-scalar", "unframe.presentation.ScalarValue"],
  ["clipless-model-node", "unframe.presentation.ProjectedNodeDefinition"],
]) {
  test(`${file}: Protobuf preserves the complete portable state`, async () => {
    const { execFileSync } = await import("node:child_process");
    const input = await readFile(resolve(root, "fixtures/wire", `${file}.textproto`), "utf8");
    const descriptor = resolve(root, "contract.pb");
    const encode = (text: string) =>
      execFileSync("protoc", [`--descriptor_set_in=${descriptor}`, `--encode=${message}`], {
        input: text,
        stdio: ["pipe", "pipe", "pipe"],
      });
    const encoded = encode(input);
    const decoded = execFileSync(
      "protoc",
      [`--descriptor_set_in=${descriptor}`, `--decode=${message}`],
      { input: encoded, encoding: "utf8" },
    );
    assert.deepEqual(encode(decoded), encoded);
    assert.ok(encoded.length > 0);
    assert.throws(() => encode(`${input}\nunknown_state: true\n`));
  });
}

test("the fixture publication closes over the exact immutable artifacts", async () => {
  const { createHash } = await import("node:crypto");
  const { default: canonicalize } = await import("canonicalize");
  const hash = (value: unknown) => {
    const canonical = canonicalize(value);
    assert.notEqual(canonical, undefined);
    return `sha256:${createHash("sha256").update(canonical!).digest("hex")}`;
  };
  const assets = assetSetManifestSchema.parse(await fixture("asset-set-manifest"));
  const build = buildManifestSchema.parse(await fixture("build-manifest"));
  const publication = publishedPresentationSchema.parse(await fixture("published-presentation"));
  assert.equal(build.definitionHash, hash(definition));
  assert.equal(bundle.definitionHash, hash(definition));
  assert.equal(build.renderBundleHash, hash(bundle));
  assert.equal(build.assetSetHash, hash(assets));
  const { publicationEpoch, publicationManifestHash, ...publishedBuild } = publication;
  assert.deepEqual(publishedBuild, build);
  assert.equal(publicationManifestHash, hash({ ...publishedBuild, publicationEpoch }));
  for (const surface of Object.values(renderBundleSchema.parse(bundle).surfaces)) {
    for (const part of Object.values(surface.renderSurfaces)) {
      for (const artifact of Object.values(part.artifacts)) {
        const descriptors =
          artifact.kind === "baked-web"
            ? Object.values(artifact.states).map((state) => state.texture)
            : artifact.kind === "video"
              ? [artifact]
              : [];
        for (const descriptor of descriptors) {
          assert.deepEqual(assets.assets[descriptor.assetId], {
            checksum: descriptor.checksum,
            mediaType: descriptor.mediaType,
            encodedSizeBytes: descriptor.encodedSizeBytes,
          });
        }
      }
    }
  }
});

test("typed state overrides and recursive scalar guards remain representable", () => {
  const valid = structuredClone(definition);
  valid.scene.surfaces.baked.states.default.contentOverrides = {
    text: { kind: "text", value: { kind: "literal", value: "Updated title" } },
    root: { kind: "frame", opacity: 0.5 },
  };
  valid.flow.groups.intro.steps.start.cues[0].guard = {
    kind: "all",
    guards: [
      {
        kind: "not",
        guard: {
          kind: "compare",
          left: { kind: "variable", variableId: "counter" },
          operator: "lt",
          right: 0,
        },
      },
    ],
  };
  assert.equal(presentationDefinitionSchema.safeParse(valid).success, true);
  assert.equal(validateDefinition(valid), true, ajv.errorsText(validateDefinition.errors));
});

test("asset catalog excludes executable Web content and standalone audio", async () => {
  const assets = await fixture("asset-set-manifest");
  for (const mediaType of ["audio/mpeg", "audio/wav", "text/html", "application/javascript"]) {
    const invalid = structuredClone(assets);
    invalid.assets.image.mediaType = mediaType;
    assert.equal(assetSetManifestSchema.safeParse(invalid).success, false);
  }
});
