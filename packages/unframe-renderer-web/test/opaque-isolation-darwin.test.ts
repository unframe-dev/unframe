import { describe, expect, it } from "vitest";
import {
  darwinSandboxProfile,
  parseProcessGroup,
  verifyDarwinGroupSample,
} from "../src/opaque/isolation/darwin.js";

describe("Darwin native isolation policy", () => {
  it("denies ambient access and only grants private scratch writes", () => {
    const profile = darwinSandboxProfile(
      ["/nix/store/runtime", '/bundle/quote"name'],
      "/private/tmp/capture",
    );
    expect(profile).toContain("(deny default)");
    expect(profile).not.toContain("(allow network");
    expect(profile).not.toContain('(subpath "/")');
    expect(profile).toContain('(allow file-write* (subpath "/private/tmp/capture"))');
    expect(profile).toContain('quote\\"name');
  });

  it("counts only the supervised process group with RSS in bytes", () => {
    expect(parseProcessGroup(" 11 11 2048\n12 11 1024\n13 13 8192\n", 11)).toEqual({
      pids: [11, 12],
      rssBytes: 3145728,
    });
  });
});

it("accounts aggregate RSS above one GiB without allocating worker memory", () => {
  expect(parseProcessGroup("11 11 524288\n12 11 524289\n", 11)).toEqual({
    pids: [11, 12],
    rssBytes: 1073742848,
  });
});

it("rejects malformed accounting instead of accepting an incomplete resource sample", () => {
  expect(() => parseProcessGroup("11 11 unknown\n", 11)).toThrow(
    "process group accounting is unavailable",
  );
});

it("requires the worker root at ready before releasing input", () => {
  expect(() => verifyDarwinGroupSample({ pids: [], rssBytes: 0 }, 11, "ready")).toThrow(
    "sandbox worker left its process group",
  );
});

it.each(["result", "monitor"] as const)(
  "allows a worker that exited normally during %s accounting",
  (phase) => {
    expect(() => verifyDarwinGroupSample({ pids: [], rssBytes: 0 }, 11, phase)).not.toThrow();
  },
);

it("enforces RSS on descendants remaining after the root exits", () => {
  expect(() => verifyDarwinGroupSample({ pids: [12], rssBytes: 1073741825 }, 11, "result")).toThrow(
    "worker exceeded monitored resources",
  );
});
