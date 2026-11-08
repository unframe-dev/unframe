// Node and Bun use different binary IPC formats; JSON carries explicitly tagged values.
type Wire =
  | null
  | boolean
  | number
  | string
  | ["string-reference", number]
  | ["undefined"]
  | ["bytes", string]
  | ["array", Wire[]]
  | ["object", [string, Wire][]];
const encodeValue = (value: unknown, strings: Map<string, number>): Wire => {
  if (typeof value === "string") {
    const index = strings.get(value);
    if (index !== undefined) return ["string-reference", index];
    strings.set(value, strings.size);
    return value;
  }
  if (value === undefined) return ["undefined"];
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (value instanceof Uint8Array) return ["bytes", Buffer.from(value).toString("base64")];
  if (Array.isArray(value)) return ["array", value.map((item) => encodeValue(item, strings))];
  if (typeof value !== "object") throw new Error("Unsupported analysis IPC value.");
  return ["object", Object.entries(value).map(([key, item]) => [key, encodeValue(item, strings)])];
};
const decodeValue = (value: Wire, strings: string[]): unknown => {
  if (!Array.isArray(value)) {
    if (typeof value === "string") strings.push(value);
    return value;
  }
  switch (value[0]) {
    case "string-reference": {
      const index = value[1];
      if (!Number.isInteger(index) || index < 0 || index >= strings.length)
        throw new Error("Invalid analysis IPC string reference.");
      return strings[index];
    }
    case "undefined":
      return undefined;
    case "bytes":
      return new Uint8Array(Buffer.from(value[1], "base64"));
    case "array":
      return value[1].map((item) => decodeValue(item, strings));
    case "object":
      return Object.fromEntries(value[1].map(([key, item]) => [key, decodeValue(item, strings)]));
  }
};

export const encodeAnalysisMessage = (value: unknown): { value: Wire } => ({
  value: encodeValue(value, new Map()),
});
export const decodeAnalysisMessage = (message: { value: Wire }): unknown =>
  decodeValue(message.value, []);
