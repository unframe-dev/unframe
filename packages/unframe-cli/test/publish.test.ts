import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishPresentation } from "../src/application/publish.js";

describe("publishPresentation", () => {
  it("rejects unsafe origins before opening project output or making requests", async () => {
    let requested = false;
    const result = await publishPresentation({
      directory: "/missing",
      presentationId: "presentation",
      controlPlaneUrl: "http://example.com/",
      bearerToken: "secret",
      fetch: (() => {
        requested = true;
        throw new Error("unexpected request");
      }) as typeof fetch,
    });
    expect(result).toEqual({ ok: false, code: "cli-publish-origin-invalid" });
    expect(requested).toBe(false);
  });

  it("rejects invalid local artifacts without sending the bearer token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-publish-"));
    try {
      const id = "a".repeat(32);
      const generation = join(directory, ".unframe", "generations", id);
      await mkdir(generation, { recursive: true });
      await symlink(`.unframe/generations/${id}`, join(directory, "dist"));
      await writeFile(join(generation, "definition.json"), "{}");
      for (const name of ["render-bundle", "asset-set", "build-manifest"])
        await writeFile(join(generation, `${name}.json`), "{}");
      let requested = false;
      const result = await publishPresentation({
        directory,
        presentationId: "presentation",
        controlPlaneUrl: "http://127.0.0.1:8787/",
        bearerToken: "secret",
        fetch: (() => {
          requested = true;
          throw new Error("unexpected request");
        }) as typeof fetch,
      });
      expect(result).toEqual({ ok: false, code: "cli-publish-build-invalid" });
      expect(requested).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized sparse build artifact before any authenticated request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-publish-"));
    try {
      const id = "a".repeat(32);
      const generation = join(directory, ".unframe", "generations", id);
      await mkdir(generation, { recursive: true });
      await symlink(`.unframe/generations/${id}`, join(directory, "dist"));
      const file = await open(join(generation, "definition.json"), "w");
      try {
        await file.truncate(512 * 1024 * 1024);
      } finally {
        await file.close();
      }
      for (const name of ["render-bundle", "asset-set", "build-manifest"])
        await writeFile(join(generation, `${name}.json`), "{}");
      let requested = false;
      const result = await publishPresentation({
        directory,
        presentationId: "presentation",
        controlPlaneUrl: "http://127.0.0.1:8787/",
        bearerToken: "secret",
        fetch: (() => {
          requested = true;
          throw new Error("unexpected request");
        }) as typeof fetch,
      });
      expect(result.ok).toBe(false);
      expect(requested).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
