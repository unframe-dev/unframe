// @vitest-environment node
import { assert, describe, expect, it, vi } from "vitest";
import { readBrowserDist } from "./read-dist";
import { hashCanonicalJsonPayload } from "@unframe/core";
import { createHash } from "node:crypto";
import { distFixture, memoryFile } from "./test-support/dist-fixture";

describe("readBrowserDist", () => {
  it("reads a complete Dist into a verified snapshot", async () => {
    const { files, artifacts } = distFixture();
    const snapshot = await readBrowserDist(files);

    expect(snapshot.artifacts).toEqual(artifacts);
    expect(snapshot.assetCount).toBe(5);
    expect(snapshot.totalAssetBytes).toBe(320);
    expect(await snapshot.readAsset("image")).toEqual({
      bytes: new Uint8Array(64).fill(1),
      mediaType: "image/png",
    });
  });

  it("rejects duplicate JSON keys even when their final values form a valid Dist", async () => {
    const { files } = distFixture();
    const receipt = files.find((file) => file.webkitRelativePath === "dist/build-receipt.json");
    assert.isDefined(receipt);
    const source = new TextDecoder().decode(receipt.bytes);
    receipt.bytes = new TextEncoder().encode(
      `{"generationId":"${"a".repeat(32)}",${source.slice(1)}`,
    );
    receipt.size = receipt.bytes.byteLength;

    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-json-invalid" });
  });

  it.each([
    ["depth beyond 64 containers", `${"[".repeat(65)}0${"]".repeat(65)}`],
    ["non-finite JSON number", '{"generationId":1e999}'],
    ["lone surrogate in a JSON string", String.raw`{"generationId":"\ud800"}`],
    ["lone surrogate in a JSON property", String.raw`{"\udc00":1}`],
  ])("rejects %s at the shared JSON boundary", async (_case, source) => {
    const { files } = distFixture();
    const replacement = memoryFile("build-receipt.json", new TextEncoder().encode(source));
    await expect(
      readBrowserDist([
        replacement,
        ...files.filter((file) => file.webkitRelativePath !== replacement.webkitRelativePath),
      ]),
    ).rejects.toMatchObject({ code: "dist-json-invalid" });
  });

  it("rejects duplicate artifact keys instead of accepting JSON.parse's last value", async () => {
    const { files } = distFixture();
    const definition = files.find((file) => file.webkitRelativePath === "dist/definition.json");
    assert.isDefined(definition);
    const source = new TextDecoder().decode(definition.bytes);
    definition.bytes = new TextEncoder().encode(`{"schemaVersion":3,${source.slice(1)}`);
    definition.size = definition.bytes.byteLength;

    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-json-invalid" });
  });

  it("keeps the verified bytes independent of selected files and returned asset buffers", async () => {
    const { files, assets } = distFixture();
    const snapshot = await readBrowserDist(files);
    for (const file of assets) file.bytes.fill(0);
    const first = await snapshot.readAsset("image");
    first.bytes.fill(0);

    expect((await snapshot.readAsset("image")).bytes).toEqual(new Uint8Array(64).fill(1));
    await expect(snapshot.readAsset("missing")).rejects.toMatchObject({
      code: "dist-asset-invalid",
    });
  });

  it("rejects an empty selection", async () => {
    await expect(readBrowserDist([])).rejects.toMatchObject({ code: "dist-empty" });
  });

  it.each([
    "dist/../definition.json",
    "dist/./definition.json",
    "/dist/definition.json",
    "dist\\definition.json",
    "dist//definition.json",
    "definition.json",
  ])("rejects the unsafe selected path %s", async (path) => {
    const { files } = distFixture();
    await expect(
      readBrowserDist([
        ...files,
        { ...memoryFile("extra", new Uint8Array()), webkitRelativePath: path },
      ]),
    ).rejects.toMatchObject({ code: "dist-path-invalid" });
  });

  it("rejects files selected from different root folders", async () => {
    const { files } = distFixture();
    await expect(
      readBrowserDist([
        ...files,
        { ...memoryFile("extra", new Uint8Array()), webkitRelativePath: "another/extra" },
      ]),
    ).rejects.toMatchObject({ code: "dist-path-invalid" });
  });

  it("rejects duplicate relative paths", async () => {
    const { files } = distFixture();
    const [first] = files;
    assert.isDefined(first);
    await expect(readBrowserDist([...files, first])).rejects.toMatchObject({
      code: "dist-file-duplicate",
    });
  });

  it("rejects a nested project folder instead of treating it as a Dist", async () => {
    const { files } = distFixture();
    const nested = files.map((file) => ({
      ...file,
      webkitRelativePath: `project/${file.webkitRelativePath}`,
    }));
    await expect(readBrowserDist(nested)).rejects.toMatchObject({ code: "dist-file-missing" });
  });

  it.each(["definition.json", "assets/image.png", "build-receipt.json"])(
    "rejects a Dist missing %s",
    async (name) => {
      const { files } = distFixture();
      await expect(
        readBrowserDist(files.filter((file) => file.webkitRelativePath !== `dist/${name}`)),
      ).rejects.toMatchObject({ code: "dist-file-missing" });
    },
  );

  it("does not read unrelated files in the selected folder", async () => {
    const { files } = distFixture();
    const read = vi
      .fn<() => Promise<ArrayBuffer>>()
      .mockRejectedValue(new Error("must not execute"));
    const ignored = { webkitRelativePath: "dist/source/code.js", size: 1024, arrayBuffer: read };
    await expect(readBrowserDist([...files, ignored])).resolves.toMatchObject({ assetCount: 5 });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects a changed manifest whose receipt no longer matches", async () => {
    const { files } = distFixture();
    const file = files.find((item) => item.webkitRelativePath === "dist/build-manifest.json");
    assert.isDefined(file);
    file.bytes[0] = 32;
    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-receipt-invalid" });
  });

  it("rejects a structurally valid changed artifact", async () => {
    const { files, artifacts } = distFixture();
    const file = files.find((item) => item.webkitRelativePath === "dist/definition.json");
    assert.isDefined(file);
    artifacts.definition.metadata.title = "Changed without rebuilding";
    file.bytes = new TextEncoder().encode(JSON.stringify(artifacts.definition));
    file.size = file.bytes.byteLength;
    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-build-invalid" });
  });

  it("rejects an asset with the expected size but different contents", async () => {
    const { files, assets } = distFixture();
    const [asset] = assets;
    assert.isDefined(asset);
    asset.bytes.fill(0);
    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-asset-invalid" });
  });

  it("rejects an oversized advertised JSON file without reading it", async () => {
    const { files } = distFixture();
    const file = files.find((item) => item.webkitRelativePath === "dist/definition.json");
    assert.isDefined(file);
    file.size = 9 * 1024 * 1024;
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-file-too-large" });
    expect(read).not.toHaveBeenCalled();
  });

  it("checks the actual returned file length as well as the advertised size", async () => {
    const { files, assets } = distFixture();
    const [asset] = assets;
    assert.isDefined(asset);
    asset.bytes = new Uint8Array(65);
    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-file-too-large" });
  });

  it("rejects a file that shrinks while being read", async () => {
    const { files, assets } = distFixture();
    const [asset] = assets;
    assert.isDefined(asset);
    asset.bytes = new Uint8Array(63);
    await expect(readBrowserDist(files)).rejects.toMatchObject({ code: "dist-file-read-failed" });
  });

  it.each([new Uint8Array([0xc3, 0x28]), new Uint8Array([0xef, 0xbb, 0xbf, 123, 125])])(
    "rejects invalid UTF-8 or a BOM in JSON",
    async (bytes) => {
      const { files } = distFixture();
      const replacement = memoryFile("build-receipt.json", bytes);
      await expect(
        readBrowserDist([
          replacement,
          ...files.filter((file) => file.webkitRelativePath !== replacement.webkitRelativePath),
        ]),
      ).rejects.toMatchObject({ code: "dist-json-invalid" });
    },
  );

  it("rejects the selection before reading any files when already cancelled", async () => {
    const { files } = distFixture();
    const controller = new AbortController();
    controller.abort();
    const [first] = files;
    assert.isDefined(first);
    const read = vi.spyOn(first, "arrayBuffer");
    await expect(readBrowserDist(files, { signal: controller.signal })).rejects.toMatchObject({
      code: "dist-cancelled",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("stops after an in-flight read finishes when cancelled", async () => {
    const { files } = distFixture();
    const controller = new AbortController();
    const [first] = files;
    assert.isDefined(first);
    first.arrayBuffer = async () => {
      controller.abort();
      return Uint8Array.from(first.bytes).buffer;
    };
    await expect(readBrowserDist(files, { signal: controller.signal })).rejects.toMatchObject({
      code: "dist-cancelled",
    });
  });

  it("bounds the number of selected entries before reading files", async () => {
    const file = memoryFile("unused", new Uint8Array());
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(readBrowserDist(Array.from({ length: 10001 }, () => file))).rejects.toMatchObject({
      code: "dist-file-count-exceeded",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects the total declared asset budget before opening assets", async () => {
    const { files, assets, artifacts } = distFixture();
    const font = artifacts.assetSet.assets["font"];
    assert.isDefined(font);
    font.encodedSizeBytes = 256 * 1024 * 1024;
    artifacts.buildManifest.assetSetHash = hashCanonicalJsonPayload(artifacts.assetSet);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(artifacts.buildManifest));
    const receiptBytes = new TextEncoder().encode(
      JSON.stringify({
        generationId: "a".repeat(32),
        buildManifestHash: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
      }),
    );
    const updated = new Map([
      ["asset-set.json", new TextEncoder().encode(JSON.stringify(artifacts.assetSet))],
      ["build-manifest.json", manifestBytes],
      ["build-receipt.json", receiptBytes],
    ]);
    const selection = files.map((file) => {
      const relative = file.webkitRelativePath.slice("dist/".length);
      const bytes = updated.get(relative);
      return bytes ? memoryFile(relative, bytes) : file;
    });
    const readers = assets.map((asset) => vi.spyOn(asset, "arrayBuffer"));
    await expect(readBrowserDist(selection)).rejects.toMatchObject({ code: "dist-file-too-large" });
    for (const read of readers) expect(read).not.toHaveBeenCalled();
  });
});
