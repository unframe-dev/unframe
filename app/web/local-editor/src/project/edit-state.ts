import type { AuthorInstance, EditCommand } from "@unframe/contracts/author-http";
export function inverseProp(instance: AuthorInstance, propId: string): EditCommand | null {
  const prop = instance.props[propId];
  if (!prop?.editable) return null;
  if (!prop.inherited)
    return { kind: "setProp", instanceId: instance.instanceId, propId, value: prop.value };
  return prop.inheritanceExpression
    ? {
        kind: "restoreProp",
        instanceId: instance.instanceId,
        propId,
        expression: prop.inheritanceExpression,
      }
    : { kind: "inheritProp", instanceId: instance.instanceId, propId };
}
export function validProp(instance: AuthorInstance, propId: string, value: unknown) {
  const prop = instance.props[propId];
  return Boolean(
    prop?.editable &&
    typeof value === prop.type &&
    (typeof value !== "number" || Number.isFinite(value)),
  );
}
