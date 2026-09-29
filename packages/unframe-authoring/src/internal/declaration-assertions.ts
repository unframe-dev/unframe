import { z } from "zod";
import type {
  FlowDeclaration,
  ResourceOwner,
  SourceMetadata,
  StableDeclaration,
} from "../domain/declarations.js";

export const invalid = (message: string): never => {
  throw new TypeError(message);
};

export const idSchema = z.string().min(1);
export const finiteNumberSchema = z.number().finite();
export const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
export const positiveSafeIntegerSchema = z.number().int().safe().positive();
export const assertId: (value: unknown, label?: string) => asserts value is string = (
  value,
  label = "id",
) => {
  if (!idSchema.safeParse(value).success) invalid(`${label} must be a non-empty id.`);
};
const assertFinite = (values: readonly number[], label: string, positive = false): void => {
  const schema = z.array(positive ? finiteNumberSchema.positive() : finiteNumberSchema);
  if (!schema.safeParse(values).success)
    invalid(`${label} must contain ${positive ? "positive " : ""}finite numbers.`);
};
export const assertVector = (
  values: readonly number[],
  length: number,
  label: string,
  positive = false,
): void => {
  if (!z.array(finiteNumberSchema).length(length).safeParse(values).success)
    invalid(`${label} must contain exactly ${length} numbers.`);
  assertFinite(values, label, positive);
};
export const assertSource = (source: SourceMetadata | undefined): void => {
  if (source === undefined) return;
  assertId(source.file, "source.file");
  const rangeSchema = z
    .tuple([nonNegativeIntegerSchema, nonNegativeIntegerSchema])
    .refine(([start, end]) => start <= end);
  if (source.range !== undefined && !rangeSchema.safeParse(source.range).success)
    invalid("source.range must be ordered non-negative integer offsets.");
};

export const assertStableNested = (value: StableDeclaration, label: string): void => {
  assertId(value.id, label);
  assertSource(value.source);
};
export const assertRecordKeys = (value: Readonly<Record<string, unknown>>, label: string): void => {
  if (!z.record(idSchema, z.unknown()).safeParse(value).success)
    invalid(`${label} must be a non-empty id.`);
};
export const assertOwner = (owner: ResourceOwner): void => {
  const result = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("presentation") }),
      z.object({ kind: z.literal("group"), groupId: idSchema }),
    ])
    .safeParse(owner);
  if (!result.success) invalid("owner.groupId must be a non-empty id.");
};
export const assertFlowIds = (flow: FlowDeclaration): void => {
  assertId(flow.initialGroupId, "flow.initialGroupId");
  assertRecordKeys(flow.groups, "flow group record key");
  for (const group of Object.values(flow.groups)) {
    assertStableNested(group, "flow group id");
    assertId(group.initialStepId, "flow group initialStepId");
    assertRecordKeys(group.steps, "flow step record key");
    for (const step of Object.values(group.steps)) {
      assertStableNested(step, "flow step id");
      for (const cueValue of step.cues) {
        assertStableNested(cueValue, "cue id");
        if (cueValue.trigger.kind === "event") assertId(cueValue.trigger.event, "cue event");
        else {
          assertId(cueValue.trigger.componentInstanceId, "cue output componentInstanceId");
          assertId(cueValue.trigger.outputId, "cue outputId");
        }
        for (const invocation of cueValue.actions) {
          assertId(invocation.componentInstanceId, "cue action componentInstanceId");
          assertId(invocation.actionId, "cue actionId");
          assertRecordKeys(invocation.arguments, "cue action argument id");
        }
        if (cueValue.toStepId !== undefined) assertId(cueValue.toStepId, "cue toStepId");
        if (cueValue.toGroupId !== undefined) assertId(cueValue.toGroupId, "cue toGroupId");
      }
    }
  }
  assertRecordKeys(flow.variables, "flow variable record key");
  for (const variable of Object.values(flow.variables)) {
    assertStableNested(variable, "flow variable id");
    assertOwner(variable.owner);
  }
};
