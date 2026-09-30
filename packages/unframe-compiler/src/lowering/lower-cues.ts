import type { ActionValue, CueGuard, PresentationDeclaration } from "@unframe/unframe-authoring";
import type { Diagnostic, PresentationDefinition } from "@unframe/unframe-core";
import type { CompilerDeclarationProject } from "../api/types.js";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { resourceId } from "./support.js";

type CanonicalCue =
  PresentationDefinition["flow"]["groups"][string]["steps"][string]["cues"][number];
type CanonicalAction = CanonicalCue["actions"][number];
type CanonicalGuard = NonNullable<CanonicalCue["guard"]>;
type Instance = PresentationDeclaration["scene"]["components"][number];

export const lowerCues = (
  presentation: PresentationDeclaration,
  components: ReadonlyArray<
    Extract<CompilerDeclarationProject["components"][number], { structure: unknown }>
  >,
  groups: PresentationDefinition["flow"]["groups"],
): Array<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = [];
  const resolve = (instanceId: string, path: Array<string | number>) => {
    const instance = presentation.scene.components.find((candidate) => candidate.id === instanceId);
    const matches =
      instance &&
      components.filter(
        (candidate) =>
          candidate.manifest.componentId === instance.componentId &&
          candidate.manifest.version === instance.version,
      );
    if (!instance || matches?.length !== 1) {
      diagnostics.push(
        diagnostic(
          "compiler-component-reference-invalid",
          path,
          "Component reference must resolve to one instance and manifest.",
        ),
      );
      return undefined;
    }
    return { entry: matches[0]!, instance };
  };
  const lowerGuard = (guard: CueGuard, instance?: Instance): CanonicalGuard => {
    if (guard.kind === "all" || guard.kind === "any") {
      return { guards: guard.guards.map((child) => lowerGuard(child, instance)), kind: guard.kind };
    }
    if (guard.kind === "not") {
      return { guard: lowerGuard(guard.guard, instance), kind: "not" };
    }
    const left = guard.left;
    return {
      ...guard,
      left:
        left.kind === "surfaceState" && instance
          ? { ...left, surfaceId: resourceId(instance.id, left.surfaceId) }
          : left.kind === "nodeField" && instance
            ? { ...left, nodeId: resourceId(instance.id, left.nodeId) }
            : left,
      right:
        left.kind === "surfaceState" && instance && typeof guard.right === "string"
          ? resourceId(instance.id, guard.right)
          : guard.right,
    } as CanonicalGuard;
  };
  const lowerValue = (
    value: ActionValue,
    args: Readonly<Record<string, ActionValue>>,
    path: Array<string | number>,
  ): Exclude<ActionValue, { kind: "input" }> => {
    if (value.kind !== "input") {
      return value;
    }
    const argument = args[value.inputId];
    if (!argument || argument.kind === "input") {
      diagnostics.push(
        diagnostic(
          "compiler-action-input-invalid",
          path,
          "Action input must have a concrete invocation argument.",
        ),
      );
      return { kind: "literal", value: null };
    }
    return argument;
  };
  for (const [groupId, group] of Object.entries(presentation.flow.groups)) {
    for (const [stepId, step] of Object.entries(group.steps)) {
      for (const [index, cue] of step.cues.entries()) {
        const path = ["presentation", "flow", "groups", groupId, "steps", stepId, "cues", index];
        let trigger: CanonicalCue["trigger"];
        let fixedPayload: CanonicalCue["fixedPayload"];
        let outputInstance: Instance | undefined;
        if (cue.trigger.kind === "event") {
          trigger = {
            actor: { kind: "presenter" },
            event: cue.trigger.event,
            kind: "semanticEvent",
          };
        } else {
          const target = resolve(cue.trigger.componentInstanceId, [...path, "trigger"]);
          outputInstance = target?.instance;
          const output = target?.entry.manifest.outputs[cue.trigger.outputId];
          if (!output) {
            diagnostics.push(
              diagnostic(
                "compiler-output-not-found",
                [...path, "trigger"],
                "Component Output must be declared by its manifest.",
              ),
            );
            continue;
          }
          fixedPayload = Object.fromEntries(
            Object.entries(output.payload).map(([key, field]) => [key, field.value]),
          );
          if (output.producer.kind === "surfaceInteraction") {
            trigger = {
              actor: { kind: "presenter" },
              interactionId: resourceId(target!.instance.id, output.producer.interactionId),
              kind: "surfaceInteraction",
              surfaceId: resourceId(target!.instance.id, target!.entry.structure.root.id),
            };
          } else if (output.producer.kind === "timer") {
            trigger = { afterMilliseconds: output.producer.afterMilliseconds, kind: "timer" };
          } else if (output.producer.kind === "timelineCompleted") {
            const timelineId = output.producer.timelineId;
            if (!target!.entry.structure.timelines.some((timeline) => timeline.id === timelineId)) {
              diagnostics.push(
                diagnostic(
                  "compiler-timeline-not-found",
                  [...path, "trigger"],
                  "Timeline Output must reference a Timeline in the same Component.",
                ),
              );
              continue;
            }
            trigger = {
              kind: "timelineCompleted",
              timelineId: resourceId(target!.instance.id, output.producer.timelineId),
            };
          } else {
            diagnostics.push(
              diagnostic(
                "compiler-output-producer-unsupported",
                [...path, "trigger"],
                "Media Output producers are not supported.",
              ),
            );
            continue;
          }
        }
        const actions: Array<CanonicalAction> = [];
        const guards: Array<CanonicalGuard> = cue.guard
          ? [lowerGuard(cue.guard, outputInstance)]
          : [];
        for (const [actionIndex, invocation] of cue.actions.entries()) {
          const actionPath = [...path, "actions", actionIndex];
          const target = resolve(invocation.componentInstanceId, actionPath);
          const declaration = target?.entry.manifest.actions[invocation.actionId];
          if (!declaration) {
            diagnostics.push(
              diagnostic(
                "compiler-action-not-found",
                actionPath,
                "Component Action must be declared by its manifest.",
              ),
            );
            continue;
          }
          for (const key of Object.keys(invocation.arguments)) {
            if (!Object.hasOwn(declaration.inputs, key)) {
              diagnostics.push(
                diagnostic(
                  "compiler-action-input-invalid",
                  [...actionPath, "arguments", key],
                  "Action argument is not declared.",
                ),
              );
            }
          }
          for (const key of Object.keys(declaration.inputs)) {
            if (!Object.hasOwn(invocation.arguments, key)) {
              diagnostics.push(
                diagnostic(
                  "compiler-action-input-invalid",
                  [...actionPath, "arguments", key],
                  "Action argument is required.",
                ),
              );
            }
          }
          for (const [key, expectedType] of Object.entries(declaration.inputs)) {
            const argument = invocation.arguments[key];
            if (!argument) {
              continue;
            }
            const actualType =
              argument.kind === "literal"
                ? argument.value === null
                  ? "null"
                  : typeof argument.value
                : argument.kind === "variable"
                  ? presentation.flow.variables[argument.variableId]?.type
                  : argument.kind === "eventPayload"
                    ? fixedPayload === undefined
                      ? undefined
                      : fixedPayload[argument.field] === null
                        ? "null"
                        : typeof fixedPayload[argument.field]
                    : "input";
            if (actualType !== undefined && actualType !== expectedType) {
              diagnostics.push(
                diagnostic(
                  "compiler-action-input-type-mismatch",
                  [...actionPath, "arguments", key],
                  "Action argument must match its declared scalar type.",
                ),
              );
            }
          }
          for (const precondition of declaration.preconditions) {
            guards.push({
              kind: "compare",
              left: {
                kind: "surfaceState",
                surfaceId: resourceId(target!.instance.id, precondition.surfaceId),
              },
              operator: "eq",
              right: resourceId(target!.instance.id, precondition.stateId),
            });
          }
          for (const [effectIndex, effect] of declaration.effects.entries()) {
            const effectPath = [...actionPath, "effects", effectIndex];
            if (effect.kind === "setSurfaceState") {
              actions.push({
                kind: "surface.setState",
                stateId: resourceId(target!.instance.id, effect.stateId),
                surfaceId: resourceId(target!.instance.id, effect.surfaceId),
                ...(effect.transition ? { transition: effect.transition } : {}),
              });
            } else if (effect.kind === "setVariable") {
              actions.push({
                kind: "variable.set",
                value: lowerValue(effect.value, invocation.arguments, effectPath),
                variableId: effect.variableId,
              });
            } else if (effect.kind === "patchNode") {
              actions.push({
                kind: "node.patch",
                nodeId: resourceId(target!.instance.id, effect.nodeId),
                patch: Object.fromEntries(
                  Object.entries(effect.patch).map(([key, value]) => [
                    key,
                    lowerValue(value, invocation.arguments, effectPath),
                  ]),
                ),
              });
            } else if (effect.kind === "playTimeline") {
              if (
                !target!.entry.structure.timelines.some(
                  (timeline) => timeline.id === effect.timelineId,
                )
              ) {
                diagnostics.push(
                  diagnostic(
                    "compiler-timeline-not-found",
                    effectPath,
                    "Timeline Action must reference a Timeline in the same Component.",
                  ),
                );
              } else {
                actions.push({
                  completion: effect.completion,
                  conflict: "reject",
                  kind: "timeline.play",
                  timelineId: resourceId(target!.instance.id, effect.timelineId),
                });
              }
            }
          }
        }
        const next: CanonicalCue["next"] =
          cue.next ??
          (cue.toStepId
            ? { kind: "step", stepId: cue.toStepId }
            : cue.toGroupId
              ? { groupId: cue.toGroupId, kind: "group" }
              : { kind: "stay" });
        groups[groupId]!.steps[stepId]!.cues.push({
          id: cue.id,
          order: cue.order ?? index,
          priority: cue.priority ?? 0,
          trigger,
          ...(fixedPayload ? { fixedPayload } : {}),
          ...(guards.length
            ? { guard: guards.length === 1 ? guards[0] : { guards, kind: "all" } }
            : {}),
          actions,
          firePolicy: cue.firePolicy ?? { kind: "oncePerStepEntry" },
          next,
        });
      }
    }
  }
  return diagnostics;
};
