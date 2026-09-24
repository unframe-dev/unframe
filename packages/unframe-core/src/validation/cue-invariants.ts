import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

import type { Diagnostic } from "../domain/model.js";
import { diagnostic, pathSegment } from "./shared.js";

type Cue = PresentationDefinitionV2["flow"]["groups"][string]["steps"][string]["cues"][number];
type Value = Extract<Cue["actions"][number], { kind: "variable.set" }>["value"];
type Owner = { kind: "presentation" } | { kind: "group"; groupId: string };
const scalarType = (value: null | boolean | number | string) =>
  value === null ? "null" : typeof value;
const accessible = (owner: Owner, groupId: string) =>
  owner.kind === "presentation" || owner.groupId === groupId;

export const validateCueInvariants = (
  definition: PresentationDefinitionV2,
  diagnostics: Diagnostic[],
) => {
  const { groups, variables } = definition.flow;
  const { nodes, surfaces } = definition.scene;
  const interactionEvents = new Set(
    Object.values(surfaces).flatMap((surface) =>
      Object.values(surface.interactions).map((interaction) => interaction.event),
    ),
  );
  for (const [groupId, group] of Object.entries(groups))
    for (const [stepId, step] of Object.entries(group.steps)) {
      const base = `/flow/groups/${pathSegment(groupId)}/steps/${pathSegment(stepId)}/cues`;
      const identities = new Set<string>();
      const priorities = new Set<string>();
      step.cues.forEach((cue, index) => {
        const path = `${base}/${index}`;
        const issue = (code: string, suffix: string, message: string) =>
          diagnostics.push(diagnostic(code, `${path}${suffix}`, message));
        if (identities.has(cue.id))
          issue("identity.invalid", "/id", "Cue ID must be unique in a Step.");
        identities.add(cue.id);
        const rank = `${cue.priority}:${cue.order}`;
        if (priorities.has(rank))
          issue("identity.invalid", "/order", "Cue priority and order must be unique in a Step.");
        priorities.add(rank);
        const target = <T extends object>(
          record: Record<string, T>,
          id: string,
          suffix: string,
        ): T | undefined => {
          const resource = record[id];
          const owner =
            resource &&
            ("owner" in resource
              ? (resource.owner as Owner)
              : "hostNodeId" in resource
                ? nodes[resource.hostNodeId as string]?.owner
                : undefined);
          if (!resource || !owner || !accessible(owner, groupId))
            issue(
              "reference.invalid",
              suffix,
              "Target must exist and be accessible from this Group.",
            );
          return resource;
        };
        const trigger = cue.trigger;
        switch (trigger.kind) {
          case "logicalInput":
          case "surfaceInteraction":
            if (trigger.actor.kind !== "presenter")
              issue("behavior.invalid", "/trigger/actor", "Input must have a Presenter actor.");
            if (trigger.kind === "surfaceInteraction") {
              const surface = target(surfaces, trigger.surfaceId, "/trigger/surfaceId");
              if (surface && !Object.hasOwn(surface.interactions, trigger.interactionId))
                issue(
                  "reference.invalid",
                  "/trigger/interactionId",
                  "Interaction does not exist on Surface.",
                );
              if (
                surface &&
                !Object.values(surface.states).some((state) =>
                  state.enabledInteractionIds.includes(trigger.interactionId),
                )
              )
                issue(
                  "behavior.invalid",
                  "/trigger/interactionId",
                  "Interaction is unavailable in every Surface State.",
                );
            }
            break;
          case "semanticEvent":
            if (trigger.actor.kind !== "presenter")
              issue(
                "behavior.invalid",
                "/trigger/actor",
                "Interaction-derived events require a Presenter actor.",
              );
            if (!interactionEvents.has(trigger.event))
              issue(
                "reference.invalid",
                "/trigger/event",
                "Semantic event must be declared by an Interaction.",
              );
            break;
          case "timer":
            break;
          case "zoneEdge":
            target(definition.stage.zones, trigger.zoneId, "/trigger/zoneId");
            break;
          case "motion":
            break;
          default:
            issue(
              "feature.unsupported",
              "/trigger",
              "Timeline, media and model triggers are not executable in this slice.",
            );
        }
        const valueType = (value: Value, suffix: string): string | undefined => {
          if (value.kind === "literal") return scalarType(value.value);
          if (value.kind === "eventPayload") {
            if (!cue.fixedPayload || !Object.hasOwn(cue.fixedPayload, value.field)) {
              issue(
                "reference.invalid",
                suffix,
                "Event payload field must exist in this Cue's fixedPayload.",
              );
              return undefined;
            }
            return scalarType(cue.fixedPayload[value.field]!);
          }
          return target(variables, value.variableId, suffix)?.type;
        };
        const expectType = (value: Value, expected: string, suffix: string) => {
          const actual = valueType(value, suffix);
          if (actual !== undefined && actual !== expected)
            issue("behavior.invalid", suffix, `Value must have type ${expected}.`);
        };
        const guard = (value: NonNullable<Cue["guard"]>, suffix: string): void => {
          if (value.kind === "all" || value.kind === "any")
            value.guards.forEach((child, i) => guard(child, `${suffix}/guards/${i}`));
          else if (value.kind === "not") guard(value.guard, `${suffix}/guard`);
          else {
            const left = value.left;
            let type: string | undefined;
            if (left.kind === "variable" || left.kind === "eventPayload")
              type = valueType(left, `${suffix}/left`);
            else if (left.kind === "surfaceState") {
              target(surfaces, left.surfaceId, `${suffix}/left/surfaceId`);
              type = "string";
            } else {
              target(nodes, left.nodeId, `${suffix}/left/nodeId`);
              type = left.field === "opacity" ? "number" : "boolean";
            }
            if (
              type &&
              (type !== scalarType(value.right) ||
                (!["eq", "neq"].includes(value.operator) && type !== "number"))
            )
              issue(
                "behavior.invalid",
                suffix,
                "Guard comparison requires compatible scalar types.",
              );
          }
        };
        if (cue.guard) guard(cue.guard, "/guard");
        const claims = new Set<string>();
        const claim = (key: string, suffix: string) => {
          if (claims.has(key))
            issue("behavior.invalid", suffix, "Action property claim overlaps another Action.");
          claims.add(key);
        };
        cue.actions.forEach((action, actionIndex) => {
          const suffix = `/actions/${actionIndex}`;
          switch (action.kind) {
            case "surface.setState": {
              const surface = target(surfaces, action.surfaceId, `${suffix}/surfaceId`);
              if (surface && !Object.hasOwn(surface.states, action.stateId))
                issue("reference.invalid", `${suffix}/stateId`, "Surface State does not exist.");
              if (action.transition?.kind === "crossfade")
                issue(
                  "feature.unsupported",
                  `${suffix}/transition`,
                  "Crossfade is not executable in this slice.",
                );
              claim(`surface:${action.surfaceId}:state`, suffix);
              break;
            }
            case "variable.set": {
              const variable = target(variables, action.variableId, `${suffix}/variableId`);
              if (variable) expectType(action.value, variable.type, `${suffix}/value`);
              claim(`variable:${action.variableId}:value`, suffix);
              break;
            }
            case "node.patch": {
              target(nodes, action.nodeId, `${suffix}/nodeId`);
              if (Object.keys(action.patch).length === 0)
                issue(
                  "behavior.invalid",
                  `${suffix}/patch`,
                  "Node patch must claim at least one field.",
                );
              for (const field of ["active", "visible", "opacity"] as const) {
                const value = action.patch[field];
                if (value) {
                  expectType(
                    value,
                    field === "opacity" ? "number" : "boolean",
                    `${suffix}/patch/${field}`,
                  );
                  if (field === "opacity") {
                    const staticValue =
                      value.kind === "literal"
                        ? value.value
                        : value.kind === "eventPayload"
                          ? cue.fixedPayload?.[value.field]
                          : undefined;
                    if (typeof staticValue === "number" && (staticValue < 0 || staticValue > 1))
                      issue(
                        "behavior.invalid",
                        `${suffix}/patch/opacity`,
                        "Node opacity must be between 0 and 1.",
                      );
                  }
                  claim(`node:${action.nodeId}:${field}`, suffix);
                }
              }
              if (action.patch.transform)
                for (const field of ["position", "rotation", "scale"])
                  claim(`node:${action.nodeId}:transform.${field}`, suffix);
              break;
            }
            default:
              issue(
                "feature.unsupported",
                suffix,
                "Timeline, media and model actions are not executable in this slice.",
              );
          }
        });
        if (cue.next.kind === "step" && !Object.hasOwn(group.steps, cue.next.stepId))
          issue("reference.invalid", "/next/stepId", "Target Step does not exist in this Group.");
        if (cue.next.kind === "group" && !Object.hasOwn(groups, cue.next.groupId))
          issue("reference.invalid", "/next/groupId", "Target Group does not exist.");
      });
    }
};
