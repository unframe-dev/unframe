import { describe, expect, it } from "vitest";
import { demoDocument } from "./demo-document";
import { createDemoAssetResolver, createDemoGlbDataUrl } from "./demo-glb";

function decodeDataUrl(url: string): Uint8Array {
  const encoded = url.split(",")[1];
  if (!encoded) throw new Error("GLB data URL is missing its payload");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

describe("demo GLB fixture", () => {
  it("creates a valid GLB 2 container", () => {
    const bytes = decodeDataUrl(createDemoGlbDataUrl());
    const header = new DataView(bytes.buffer);

    expect(header.getUint32(0, true)).toBe(0x46546c67);
    expect(header.getUint32(4, true)).toBe(2);
    expect(header.getUint32(8, true)).toBe(bytes.byteLength);
  });

  it("keeps the runtime GLB URL outside the document", () => {
    const resolver = createDemoAssetResolver();

    expect(resolver.resolve("demo-model")).toMatch(/^data:model\/gltf-binary;base64,/);
    expect(JSON.stringify(demoDocument)).not.toContain("base64");
  });
});
