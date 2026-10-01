import type {
  ComponentInstanceDeclaration,
  ContentNodeDeclaration,
} from "@unframe/unframe-authoring";
import type { Diagnostic } from "@unframe/unframe-core";
import { diagnostic } from "../diagnostics/diagnostics.js";
import type { CompilerDeclarationProject } from "../api/types.js";

export const sameOwner = (
  left: ComponentInstanceDeclaration["owner"],
  right: ComponentInstanceDeclaration["owner"],
): boolean =>
  left.kind === right.kind &&
  (left.kind === "presentation" || (right.kind === "group" && left.groupId === right.groupId));

export const checkSlotComposition = (
  instances: readonly ComponentInstanceDeclaration[],
  components: CompilerDeclarationProject["components"],
): { nestedInstanceIds: ReadonlySet<string>; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const instanceIndexById = new Map(instances.map((instance, index) => [instance.id, index]));
  const nestedInstanceIds = new Set<string>();
  const slotEdges = new Map<string, string[]>();
  const collectSlotIds = (node: ContentNodeDeclaration): string[] => {
    if (node.kind === "slot-placeholder") return [node.slotId];
    if (node.kind === "text") return [];
    return node.children.flatMap(collectSlotIds);
  };
  for (const [index, instance] of instances.entries()) {
    const path = ["presentation", "scene", "components", index] as const;
    const entries = components.filter(
      (candidate) =>
        candidate.manifest.componentId === instance.componentId &&
        candidate.manifest.version === instance.version,
    );
    if (entries.length !== 1) continue;
    const entry = entries[0]!;
    if (!("structure" in entry)) {
      if (Object.keys(instance.slots).length)
        diagnostics.push(
          diagnostic(
            "compiler-opaque-slot-unsupported",
            [...path, "slots"],
            "Opaque Components cannot contain Slots.",
          ),
        );
      continue;
    }
    const slotIds = collectSlotIds(
      entry.structure.root.kind === "surface" ? entry.structure.root.root : entry.structure.root,
    );
    const declaredSlotIds = Object.keys(entry.manifest.slots);
    if (
      new Set(slotIds).size !== slotIds.length ||
      [...new Set(slotIds)].sort().join("\0") !== [...declaredSlotIds].sort().join("\0")
    )
      diagnostics.push(
        diagnostic(
          "compiler-slot-placeholder-set-mismatch",
          [...path, "structure"],
          "Each declared Slot must have exactly one Frame child placeholder.",
        ),
      );
    const children: string[] = [];
    for (const [slotId, childIds] of Object.entries(instance.slots)) {
      if (!Object.hasOwn(entry.manifest.slots, slotId))
        diagnostics.push(
          diagnostic(
            "compiler-slot-not-found",
            [...path, "slots", slotId],
            "Instance Slot values must name a declared Slot.",
          ),
        );
      for (const childId of childIds) {
        const child = instanceById.get(childId);
        if (!child)
          diagnostics.push(
            diagnostic(
              "compiler-slot-instance-not-found",
              [...path, "slots", slotId],
              "Slotted Component instance IDs must resolve.",
            ),
          );
        else {
          if (childId === instance.id)
            diagnostics.push(
              diagnostic(
                "compiler-slot-self-reference",
                [...path, "slots", slotId],
                "A Component instance cannot slot itself.",
              ),
            );
          if (!sameOwner(child.owner, instance.owner))
            diagnostics.push(
              diagnostic(
                "compiler-slot-owner-mismatch",
                [...path, "slots", slotId],
                "Slotted Component instances must have the same owner.",
              ),
            );
          if (nestedInstanceIds.has(childId))
            diagnostics.push(
              diagnostic(
                "compiler-slot-instance-duplicate",
                [...path, "slots", slotId],
                "A Component instance may appear in only one Slot position.",
              ),
            );
          nestedInstanceIds.add(childId);
          children.push(childId);
        }
      }
    }
    slotEdges.set(instance.id, children);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitSlots = (instanceId: string): void => {
    if (visiting.has(instanceId)) {
      diagnostics.push(
        diagnostic(
          "compiler-slot-cycle",
          ["presentation", "scene", "components", instanceIndexById.get(instanceId) ?? 0, "slots"],
          "Slot composition must not contain a cycle.",
        ),
      );
      return;
    }
    if (visited.has(instanceId)) return;
    visiting.add(instanceId);
    for (const childId of slotEdges.get(instanceId) ?? []) visitSlots(childId);
    visiting.delete(instanceId);
    visited.add(instanceId);
  };
  for (const instance of instances) visitSlots(instance.id);
  for (const [index, instance] of instances.entries()) {
    const nested = nestedInstanceIds.has(instance.id);
    const entry = components.find(
      (candidate) =>
        candidate.manifest.componentId === instance.componentId &&
        candidate.manifest.version === instance.version,
    );
    if (!entry) continue;
    if (!("structure" in entry)) continue;
    if (nested && (instance.spatialNodeId !== undefined || entry.structure.root.kind !== "frame"))
      diagnostics.push(
        diagnostic(
          "compiler-slotted-component-invalid",
          ["presentation", "scene", "components", index],
          "Slotted instances must omit spatialNodeId and use a Frame-root Component.",
        ),
      );
    if (
      !nested &&
      (instance.spatialNodeId === undefined || entry.structure.root.kind !== "surface")
    )
      diagnostics.push(
        diagnostic(
          "compiler-top-level-component-invalid",
          ["presentation", "scene", "components", index],
          "Top-level instances must reference a Spatial node and use a Surface-root Component.",
        ),
      );
  }
  return { nestedInstanceIds, diagnostics };
};
