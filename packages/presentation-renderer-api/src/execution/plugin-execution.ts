import type { Diagnostic, HitRegion } from "@unframe/presentation-core";
import {
  type CompilerResolvedSurfaceInput,
  type RendererBuildResult,
  type RendererBuildSuccess,
  type RendererConformanceFixture,
  type RendererPlugin,
  type RendererSupportDecision,
  type RendererSupportRequest,
  type ValidationResult,
} from "../public-types.js";
import {
  diagnostic,
  evaluateFirstMilestoneSupport,
} from "../capabilities/evaluate-first-milestone.js";
import {
  capturePixelSizeSchema,
  hitRegionPrioritySchema,
  normalizedHitRegionBoundsSchema,
} from "../validation/schemas.js";
import {
  parseBuildResult,
  parseSupportDecision,
  prepareRendererBoundary,
} from "../boundary/renderer-plugin.js";
import { copyUint8Array } from "../boundary/shared/safe-data.js";
import { prepareRendererPlugin } from "../boundary/plugin-validation.js";

import { snapshot, sortedDiagnostics } from "../boundary/renderer-plugin.js";

const validateProvenance = (
  fixture: RendererConformanceFixture,
  plugin: RendererPlugin,
  result: RendererBuildSuccess,
  diagnostics: Diagnostic[],
) => {
  const expected = {
    ...plugin.identity,
    inputHash: fixture.input.context.inputHash,
    buildContextHash: fixture.input.context.buildContextHash,
    environmentHash: fixture.input.context.environmentHash,
    rendererConfigHash: fixture.input.context.rendererConfigHash,
    rendererFingerprint: fixture.input.context.rendererFingerprint,
  };
  if (snapshot(result.provenance) !== snapshot(expected))
    diagnostics.push(
      diagnostic(
        "invalid-renderer-provenance",
        "Renderer provenance does not match identity/context.",
        [fixture.name, "output", "provenance"],
      ),
    );
};

const validateHitRegion = (
  fixture: RendererConformanceFixture,
  stateId: string,
  region: HitRegion,
  diagnostics: Diagnostic[],
) => {
  const path = [
    fixture.name,
    "output",
    "hitRegionsByState",
    stateId,
    region.interactionId,
  ] as const;
  if (!normalizedHitRegionBoundsSchema.safeParse(region.bounds).success)
    diagnostics.push(
      diagnostic(
        "invalid-hit-region-bounds",
        "Hit Region must use finite normalized bounds.",
        path,
      ),
    );

  const interaction = fixture.input.surface.interactions[region.interactionId];
  const semanticNode = fixture.input.semanticsByState[stateId]?.nodes[region.semanticNodeId];
  const surfaceState = fixture.input.surface.states[stateId];
  if (
    interaction === undefined ||
    interaction.event !== region.event ||
    !surfaceState?.enabledInteractionIds.includes(region.interactionId)
  )
    diagnostics.push(
      diagnostic(
        "invalid-hit-region-interaction",
        "Hit Region must match a declared interaction.",
        path,
      ),
    );
  if (semanticNode === undefined || semanticNode.interactionId !== region.interactionId)
    diagnostics.push(
      diagnostic(
        "invalid-hit-region-semantic-node",
        "Hit Region must match a Semantic Node.",
        path,
      ),
    );
  if (!hitRegionPrioritySchema.safeParse(region.priority).success)
    diagnostics.push(
      diagnostic("invalid-hit-region-priority", "Hit Region priority must be non-negative.", path),
    );
};

const validateSuccess = (
  fixture: RendererConformanceFixture,
  plugin: RendererPlugin,
  result: RendererBuildSuccess,
  diagnostics: Diagnostic[],
) => {
  const { input, name } = fixture;
  const expectedSurface = {
    id: input.plan.id,
    semanticSurfaceId: input.plan.semanticSurfaceId,
    logicalBounds: input.plan.logicalBounds,
    layer: input.plan.layer,
  };
  if (snapshot(result.renderSurface) !== snapshot(expectedSurface))
    diagnostics.push(
      diagnostic("render-surface-plan-mismatch", "Renderer changed the Compiler render plan.", [
        name,
        "output",
        "renderSurface",
      ]),
    );

  validateProvenance(fixture, plugin, result, diagnostics);

  const captureIds = new Set<string>();
  const capturesByState = new Map<string, number>();
  for (const capture of result.captures) {
    if (captureIds.has(capture.id))
      diagnostics.push(
        diagnostic("duplicate-capture-id", "Capture IDs must be unique and non-empty.", [
          name,
          "output",
          "captures",
          capture.id,
        ]),
      );
    captureIds.add(capture.id);
    capturesByState.set(capture.stateId, (capturesByState.get(capture.stateId) ?? 0) + 1);
    if (!capturePixelSizeSchema.safeParse(capture.pixelSize).success)
      diagnostics.push(
        diagnostic("invalid-capture-size", "Capture size must contain positive integers.", [
          name,
          "output",
          "captures",
          capture.id,
          "pixelSize",
        ]),
      );
    else if (snapshot(capture.pixelSize) !== snapshot(input.context.pixelTarget))
      diagnostics.push(
        diagnostic("capture-size-mismatch", "Capture size must match the requested pixel target.", [
          name,
          "output",
          "captures",
          capture.id,
          "pixelSize",
        ]),
      );
    const rgba = copyUint8Array(capture.rgba);
    const expectedBytes = capture.pixelSize[0] * capture.pixelSize[1] * 4;
    if (rgba && rgba.length !== expectedBytes)
      diagnostics.push(
        diagnostic("invalid-rgba-length", "Raw RGBA byte length does not match pixel size.", [
          name,
          "output",
          "captures",
          capture.id,
          "rgba",
        ]),
      );
    if (
      rgba &&
      capture.alphaMode === "opaque" &&
      rgba.some((_, index) => index % 4 === 3 && rgba[index] !== 255)
    )
      diagnostics.push(
        diagnostic("invalid-opaque-alpha", "Opaque captures must use alpha 255 for every pixel.", [
          name,
          "output",
          "captures",
          capture.id,
          "rgba",
        ]),
      );
  }

  for (const [stateId, statePlan] of Object.entries(input.plan.states)) {
    const count = capturesByState.get(stateId) ?? 0;
    if (
      (statePlan.kind === "capture" && count !== 1) ||
      (statePlan.kind === "empty" && count !== 0)
    )
      diagnostics.push(
        diagnostic(
          "state-capture-mismatch",
          "Capture output must satisfy the planned state binding.",
          [name, "output", "captures", stateId],
        ),
      );
    if (!Object.hasOwn(result.hitRegionsByState, stateId))
      diagnostics.push(
        diagnostic("missing-state-hit-regions", "Every planned state needs Hit Region output.", [
          name,
          "output",
          "hitRegionsByState",
          stateId,
        ]),
      );
    const regions = result.hitRegionsByState[stateId];
    if (!regions) continue;
    if (input.resolvedIntent.interaction.kind === "none" && regions.length > 0)
      diagnostics.push(
        diagnostic(
          "unexpected-hit-region",
          "Interaction-free surfaces must not produce Hit Regions.",
          [name, "output", "hitRegionsByState", stateId],
        ),
      );
    const coveredInteractionIds = new Set(regions.map((region) => region.interactionId));
    for (const interactionId of input.surface.states[stateId]?.enabledInteractionIds ?? [])
      if (!coveredInteractionIds.has(interactionId))
        diagnostics.push(
          diagnostic(
            "missing-enabled-interaction-region",
            "Every enabled interaction must have at least one Hit Region.",
            [name, "output", "hitRegionsByState", stateId],
          ),
        );
  }
  for (const stateId of capturesByState.keys())
    if (!Object.hasOwn(input.plan.states, stateId))
      diagnostics.push(
        diagnostic("unexpected-capture-state", "Capture references an unplanned state.", [
          name,
          "output",
          "captures",
          stateId,
        ]),
      );
  for (const [stateId, regions] of Object.entries(result.hitRegionsByState)) {
    if (!Object.hasOwn(input.plan.states, stateId))
      diagnostics.push(
        diagnostic("unexpected-hit-region-state", "Hit Regions reference an unplanned state.", [
          name,
          "output",
          "hitRegionsByState",
          stateId,
        ]),
      );
    for (const region of regions) validateHitRegion(fixture, stateId, region, diagnostics);
  }
};

type CallResult = { readonly threw: true } | { readonly threw: false; readonly value: unknown };

const callBuild = async (
  plugin: RendererPlugin,
  input: CompilerResolvedSurfaceInput,
): Promise<CallResult> => {
  try {
    return { threw: false, value: await plugin.build(input) };
  } catch {
    return { threw: true };
  }
};

const callSupport = (plugin: RendererPlugin, request: RendererSupportRequest): CallResult => {
  try {
    return { threw: false, value: plugin.support(request) };
  } catch {
    return { threw: true };
  }
};

export const executeRendererPlugin = async (
  plugin: RendererPlugin,
  input: CompilerResolvedSurfaceInput,
): Promise<ValidationResult<RendererBuildSuccess>> => {
  try {
    const diagnostics: Diagnostic[] = [];
    const prepared = prepareRendererBoundary(input, plugin, ["single", "input"]);
    if (!prepared.valid) return { valid: false, diagnostics: [...prepared.diagnostics] };
    const fixture: RendererConformanceFixture = { name: "single", input: prepared.value.input };
    const preparedPlugin = prepared.value.plugin;
    const before = snapshot(fixture.input);
    const request = { entry: fixture.input.entry, resolvedIntent: fixture.input.resolvedIntent };
    const supportCall = callSupport(preparedPlugin, request);
    if (supportCall.threw)
      diagnostics.push(
        diagnostic("renderer-support-threw", "support() must return a diagnostic decision.", []),
      );
    else if (!parseSupportDecision(supportCall.value).success)
      diagnostics.push(
        diagnostic(
          "malformed-support-decision",
          "support() must return a structured diagnostic decision.",
          [],
        ),
      );
    if (snapshot(fixture.input) !== before)
      diagnostics.push(
        diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", []),
      );
    if (diagnostics.length > 0)
      return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
    const expected = evaluateFirstMilestoneSupport(request);
    if (
      snapshot((supportCall as { readonly value: RendererSupportDecision }).value) !==
      snapshot(expected)
    )
      diagnostics.push(
        diagnostic("invalid-support-decision", "support() must follow declared capabilities.", []),
      );
    if (diagnostics.length > 0)
      return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
    if (!expected.supported)
      return { valid: false, diagnostics: sortedDiagnostics([...expected.diagnostics]) };
    const buildCall = await callBuild(preparedPlugin, fixture.input);
    if (buildCall.threw)
      diagnostics.push(
        diagnostic("renderer-threw", "Renderer failures must be returned as diagnostics.", []),
      );
    else if (!parseBuildResult(buildCall.value).success)
      diagnostics.push(
        diagnostic(
          "malformed-renderer-output",
          "build() must return a structured renderer result.",
          [],
        ),
      );
    if (snapshot(fixture.input) !== before)
      diagnostics.push(
        diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", []),
      );
    if (diagnostics.length > 0)
      return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
    const support = parseSupportDecision((supportCall as { readonly value: unknown }).value)
      .data as RendererSupportDecision;
    const result = parseBuildResult((buildCall as { readonly value: unknown }).value)
      .data as RendererBuildResult;
    if (support.supported !== result.ok)
      diagnostics.push(diagnostic("support-build-mismatch", "support() and build() disagree.", []));
    if (result.ok) validateSuccess(fixture, preparedPlugin, result, diagnostics);
    else if (result.diagnostics.length === 0)
      diagnostics.push(
        diagnostic("missing-failure-diagnostic", "Renderer failure must include a diagnostic.", []),
      );
    if (!result.ok)
      return {
        valid: false,
        diagnostics: sortedDiagnostics([...diagnostics, ...result.diagnostics]),
      };
    return diagnostics.length === 0
      ? { valid: true, value: result, diagnostics: [] }
      : { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-renderer-boundary", "Renderer boundary input is invalid.", []),
      ],
    };
  }
};

const runRendererConformanceUnchecked = async (
  plugin: RendererPlugin,
  fixtures: readonly RendererConformanceFixture[],
): Promise<ValidationResult<readonly RendererBuildResult[]>> => {
  const diagnostics: Diagnostic[] = [];
  const results: RendererBuildResult[] = [];

  for (const fixture of fixtures) {
    const prepared = prepareRendererBoundary(
      fixture.input,
      plugin,
      [fixture.name, "input"],
      plugin,
    );
    if (!prepared.valid) {
      diagnostics.push(...prepared.diagnostics);
      continue;
    }
    const preparedFixture: RendererConformanceFixture = {
      name: fixture.name,
      input: prepared.value.input,
    };
    const inputSnapshot = snapshot(preparedFixture.input);
    const request = {
      entry: preparedFixture.input.entry,
      resolvedIntent: preparedFixture.input.resolvedIntent,
    };
    const expectedSupport = evaluateFirstMilestoneSupport(request);
    const supportCall = callSupport(plugin, request);
    if (supportCall.threw) {
      diagnostics.push(
        diagnostic("renderer-support-threw", "support() must return a diagnostic decision.", [
          fixture.name,
          "support",
        ]),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const supportResult = parseSupportDecision(supportCall.value);
    if (!supportResult.success) {
      diagnostics.push(
        diagnostic(
          "malformed-support-decision",
          "support() must return a structured diagnostic decision.",
          [fixture.name, "support"],
        ),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const support = supportResult.data as RendererSupportDecision;
    if (snapshot(support) !== snapshot(expectedSupport))
      diagnostics.push(
        diagnostic("invalid-support-decision", "support() must follow declared capabilities.", [
          fixture.name,
          "support",
        ]),
      );

    const firstCall = await callBuild(plugin, preparedFixture.input);
    if (firstCall.threw) {
      diagnostics.push(
        diagnostic("renderer-threw", "Renderer failures must be returned as diagnostics.", [
          fixture.name,
          "build",
        ]),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const firstResult = parseBuildResult(firstCall.value);
    if (!firstResult.success) {
      diagnostics.push(
        diagnostic(
          "malformed-renderer-output",
          "build() must return a structured renderer result.",
          [fixture.name, "build"],
        ),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const first = firstResult.data as RendererBuildResult;
    const firstSnapshot = snapshot(first);
    results.push(first);

    if (support.supported !== first.ok)
      diagnostics.push(
        diagnostic("support-build-mismatch", "support() and build() disagree.", [
          fixture.name,
          "build",
        ]),
      );

    if (!first.ok) {
      if (first.diagnostics.length === 0)
        diagnostics.push(
          diagnostic("missing-failure-diagnostic", "Renderer failure must include a diagnostic.", [
            fixture.name,
            "build",
            "diagnostics",
          ]),
        );
    } else validateSuccess(preparedFixture, plugin, first, diagnostics);
    if (plugin.capabilities.deterministic) {
      const secondCall = await callBuild(plugin, preparedFixture.input);
      if (
        secondCall.threw ||
        !parseBuildResult(secondCall.value).success ||
        firstSnapshot !== snapshot(parseBuildResult(secondCall.value).data)
      )
        diagnostics.push(
          diagnostic(
            "non-deterministic-renderer-output",
            "Deterministic renderer output changed.",
            [fixture.name, "build"],
          ),
        );
    }
    if (snapshot(preparedFixture.input) !== inputSnapshot)
      diagnostics.push(
        diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
          fixture.name,
          "input",
        ]),
      );
  }

  return diagnostics.length === 0
    ? { valid: true, value: results, diagnostics: [] }
    : { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
};

export const runRendererConformance = async (
  plugin: RendererPlugin,
  fixtures: readonly RendererConformanceFixture[],
): Promise<ValidationResult<readonly RendererBuildResult[]>> => {
  try {
    const preparedPlugin = prepareRendererPlugin(plugin);
    if (!preparedPlugin.valid)
      return { valid: false, diagnostics: [...preparedPlugin.diagnostics] };
    return await runRendererConformanceUnchecked(preparedPlugin.value, fixtures);
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-renderer-boundary", "Renderer boundary input is invalid.", []),
      ],
    };
  }
};
