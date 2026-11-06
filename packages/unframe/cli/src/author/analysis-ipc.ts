// Node and Bun use different binary IPC formats; JSON carries explicitly tagged values.
type Wire =
  | null
  | boolean
  | number
  | string
  | ["undefined"]
  | ["bytes", string]
  | ["array", Wire[]]
  | ["object", [string, Wire][]];
const encodeValue = (value: unknown): Wire => {
  if (value === undefined) return ["undefined"];
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  if (value instanceof Uint8Array) return ["bytes", Buffer.from(value).toString("base64")];
  if (Array.isArray(value)) return ["array", value.map(encodeValue)];
  if (typeof value !== "object") throw new Error("Unsupported analysis IPC value.");
  return ["object", Object.entries(value).map(([key, item]) => [key, encodeValue(item)])];
};
const decodeValue = (value: Wire): unknown => {
  if (!Array.isArray(value)) return value;
  switch (value[0]) {
    case "undefined":
      return undefined;
    case "bytes":
      return new Uint8Array(Buffer.from(value[1], "base64"));
    case "array":
      return value[1].map(decodeValue);
    case "object":
      return Object.fromEntries(value[1].map(([key, item]) => [key, decodeValue(item)]));
  }
};

export const encodeAnalysisMessage = (value: unknown): { value: Wire } => ({
  value: encodeValue(value),
});
export const decodeAnalysisMessage = (message: { value: Wire }): unknown =>
  decodeValue(message.value);
