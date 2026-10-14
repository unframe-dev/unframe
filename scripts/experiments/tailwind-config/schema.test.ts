import assert from "node:assert/strict";
import test from "node:test";
import { project, run } from "./harness.ts";
import { manifestSchema, requestSchema, responseSchema, sourceMapSchema } from "./schemas.ts";

test("worker protocol rejects malformed requests and responses", () => {
  assert.equal(
    requestSchema.safeParse({ root: 42, loaderUrl: "invalid", plainOptions: false }).success,
    false,
  );
  assert.equal(responseSchema.safeParse({ ok: true, css: 42 }).success, false);
  assert.equal(
    responseSchema.safeParse({ ok: false, phase: "unknown", name: "Error", error: "failure" })
      .success,
    false,
  );
  assert.equal(
    manifestSchema.safeParse({ packageManager: "pnpm", dependencies: { postcss: 42 } }).success,
    false,
  );
});

test("source maps retain absent original source contents", () => {
  const map = {
    version: 3,
    sources: ["generated.css"],
    sourcesContent: [null],
    names: [],
    mappings: "",
  };
  assert.deepEqual(sourceMapSchema.parse(map), map);
  assert.equal(sourceMapSchema.safeParse({ ...map, sourcesContent: [42] }).success, false);
});

test("worker rejects CSS inputs outside the project root", async (t) => {
  const fixture = await project();
  t.after(fixture.cleanup);
  for (const input of ["../outside.css", ".", `${fixture.root}-sibling/input.css`]) {
    const result = await run(fixture.root, { input });
    assert.equal(result.ok, false);
    assert.equal(result.phase, "boundary");
    assert.match(result.error, /Input escapes project root/);
  }
});
