import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

import type { Diagnostic } from "../domain/model.js";
import { diagnostic, pathSegment } from "./shared.js";

type Audience = PresentationDefinitionV2["scene"]["nodes"][string]["audience"];

const canReferenceAudience = (source: Audience, target: Audience) =>
  target.kind === "all" ||
  (source.kind === "role" && target.kind === "role" && source.role === target.role);

export const validateProjectionAudienceInvariants = (
  definition: PresentationDefinitionV2,
  diagnostics: Diagnostic[],
) => {
  const nodes = definition.scene.nodes;
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.parent.kind !== "node") continue;
    const parent = nodes[node.parent.nodeId];
    if (parent && !canReferenceAudience(node.audience, parent.audience))
      diagnostics.push(
        diagnostic(
          "graph.invalid",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "Spatial child audience must be contained by its parent's audience.",
        ),
      );
  }
};
