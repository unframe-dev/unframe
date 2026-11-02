import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { runPresentationCli } from "../src/index.js";
import { prepareProjectFixture } from "./prepared-project-fixture.js";

it("keeps the prepared Source and frozen dependency lock consistent", async () => {
  const project = await prepareProjectFixture();
  try {
    const result = await runPresentationCli({ args: ["check", project] });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}, 30_000);
