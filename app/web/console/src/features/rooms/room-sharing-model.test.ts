import { it, expect } from "vitest";
import { audienceJoinUrl } from "./room-sharing-model";

it("builds the anonymous invitation in the URL fragment", () => {
  expect(audienceJoinUrl("ABCD-EFGH", "https://audience.example.com")).toBe(
    "https://audience.example.com/#join=ABCD-EFGH",
  );
});

it.each([
  "http://audience.example.com",
  "https://user:pass@audience.example.com",
  "https://audience.example.com/path",
  "https://audience.example.com?x=1",
  "https://audience.example.com/#old",
  "invalid",
])("rejects an invalid Audience origin: %s", (origin) => {
  expect(() => audienceJoinUrl("ABCD-EFGH", origin)).toThrow();
});
