import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import protobuf from "protobufjs/light";

import descriptor from "../presentation/v2/wire-descriptor.json";
import { formatGenerated } from "./format-generated";

const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace);
root.resolveAll();
const messages: protobuf.Type[] = [];
function collect(namespace: protobuf.Namespace): void {
  for (const nested of namespace.nestedArray) {
    if (nested instanceof protobuf.Type) messages.push(nested);
    if (nested instanceof protobuf.Namespace) collect(nested);
  }
}
collect(root);
const names = new Map<string, number>();
for (const type of messages) names.set(type.name, (names.get(type.name) ?? 0) + 1);
function typeName(type: protobuf.Type): string {
  if (names.get(type.name) === 1) return `${type.name}Wire`;
  return `${type.fullName.slice(1).replaceAll(".", "_")}Wire`;
}
function fieldType(field: protobuf.Field): string {
  let result: string;
  if (field.resolvedType instanceof protobuf.Type) result = typeName(field.resolvedType);
  else if (field.resolvedType instanceof protobuf.Enum) result = "number";
  else if (["uint64", "fixed64", "int64", "sint64", "sfixed64"].includes(field.type))
    result = "string";
  else if (field.type === "string") result = "string";
  else if (field.type === "bool") result = "boolean";
  else if (field.type === "bytes") result = "Uint8Array";
  else result = "number";
  if (field.map) return `Record<string, ${result}>`;
  return field.repeated ? `${result}[]` : result;
}

const lines = ["// Generated from packages/contracts/proto; run pnpm generate:wire-types.", ""];
for (const type of messages.sort((a, b) => a.fullName.localeCompare(b.fullName, "en"))) {
  const oneofFields = new Set(type.oneofsArray.flatMap((oneof) => oneof.oneof));
  const name = typeName(type);
  lines.push(`export interface ${name}${type.oneofsArray.length ? "Fields" : ""} {`);
  for (const field of type.fieldsArray) {
    if (!oneofFields.has(field.name)) lines.push(`  ${field.name}?: ${fieldType(field)};`);
  }
  lines.push("}");
  for (const oneof of type.oneofsArray) {
    const selected = oneof.oneof.map((name) => type.fields[name]!);
    const variants = selected.map((field) => {
      const others = selected
        .filter((candidate) => candidate !== field)
        .map((candidate) => `${candidate.name}?: never`)
        .join("; ");
      return `{ ${field.name}: ${fieldType(field)}; ${others} }`;
    });
    if (
      (oneof.name.startsWith("_") && selected.length === 1) ||
      (type.fullName === ".unframe.realtime.v2.CommandAccepted" && oneof.name === "cueEvaluation")
    ) {
      variants.push(`{ ${selected.map((field) => `${field.name}?: never`).join("; ")} }`);
    }
    lines.push(`export type ${typeName(type)}_${oneof.name} = ${variants.join(" | ")};`);
  }
  if (type.oneofsArray.length) {
    lines.push(
      `export type ${name} = ${name}Fields & ${type.oneofsArray.map((oneof) => `${name}_${oneof.name}`).join(" & ")};`,
    );
  }
  lines.push("");
}
const destination = resolve(import.meta.dirname, "../presentation/v2/wire-types.d.ts");
const content = formatGenerated(destination, `${lines.join("\n")}\n`);
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== content) {
    process.stderr.write("Wire TypeScript types are stale\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(destination, content);
}
