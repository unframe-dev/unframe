import { decodeWireMessage, encodeWireMessage } from "@unframe/contracts/presentation";

export function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error("invalid-runtime-input");
}
export function uint(value: string | undefined): number {
  const text = value ?? "0";
  requireValue(/^(0|[1-9][0-9]*)$/.test(text));
  const number = Number(text);
  requireValue(Number.isSafeInteger(number) && number >= 0);
  return number;
}
export function id(value: string | undefined): asserts value is string {
  requireValue(
    typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= 128,
  );
}
export function cloneWire<T extends object>(type: string, value: T): T {
  return decodeWireMessage(type, encodeWireMessage(type, value)) as T;
}
export function sameWire(type: string, a: object | undefined, b: object | undefined): boolean {
  if (!a || !b) return false;
  const first = encodeWireMessage(type, a);
  const second = encodeWireMessage(type, b);
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}
