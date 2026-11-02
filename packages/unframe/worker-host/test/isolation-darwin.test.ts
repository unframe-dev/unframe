import { describe, expect, it } from "vitest";
import { darwinSandboxProfile, parseProcessGroup, verifyDarwinGroupSample } from "../src/darwin.js";

describe("Darwin native isolation policy", () => {
  it("denies ambient access and only grants private scratch writes", () => {
    const profile = darwinSandboxProfile(
      ["/nix/store/runtime", '/bundle/quote"name'],
      "/private/tmp/capture",
    );
    expect(profile).toContain("(deny default)");
    expect(profile).not.toContain("(allow network");
    expect(profile).not.toContain('(subpath "/")');
    expect(profile).toContain('(allow file-read* (literal "/"))');
    for (const path of ["/private", "/private/tmp", "/nix", "/nix/store", "/bundle"]) {
      expect(profile).toContain(`(allow file-read-metadata (literal "${path}"))`);
      expect(profile).not.toContain(`(allow file-read* (subpath "${path}"))`);
    }
    expect(profile).toContain('(allow file-write* (subpath "/private/tmp/capture"))');
    expect(profile).toContain('quote\\"name');
  });

  it("counts only the supervised process group with RSS in bytes", () => {
    expect(parseProcessGroup(" 11 1 11 2048\n12 11 11 1024\n13 1 13 8192\n", 11)).toEqual({
      pids: [11, 12],
      rssBytes: 3145728,
    });
  });
});

it("accounts aggregate RSS above one GiB without allocating worker memory", () => {
  expect(parseProcessGroup("11 1 11 524288\n12 11 11 524289\n", 11)).toEqual({
    pids: [11, 12],
    rssBytes: 1073742848,
  });
});

it("rejects malformed accounting instead of accepting an incomplete resource sample", () => {
  expect(() => parseProcessGroup("11 1 11 unknown\n", 11)).toThrow(
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

it("tracks detached descendants and expands their known process groups", () => {
  const groups = new Set([11]);
  expect(parseProcessGroup("11 1 11 1\n12 11 12 2\n13 12 13 3\n14 1 14 4\n", 11, groups)).toEqual({
    pids: [11, 12, 13],
    rssBytes: 6 * 1024,
  });
  expect([...groups]).toEqual([11, 12, 13]);
  expect(parseProcessGroup("12 1 12 2\n13 1 13 3\n15 13 15 5\n14 1 14 4\n", 11, groups)).toEqual({
    pids: [12, 13, 15],
    rssBytes: 10 * 1024,
  });
  expect([...groups]).toEqual([12, 13, 15]);
});

it("enforces aggregate resources across detached descendant groups", () => {
  const usage = parseProcessGroup("11 1 11 524288\n12 11 12 524289\n", 11);
  expect(() => verifyDarwinGroupSample(usage, 11, "result")).toThrow(
    "worker exceeded monitored resources",
  );
});

it("enforces process count across detached descendant groups", () => {
  const output = Array.from(
    { length: 129 },
    (_, index) => `${index + 11} ${index === 0 ? 1 : 11} ${index + 11} 1`,
  ).join("\n");
  expect(() => verifyDarwinGroupSample(parseProcessGroup(output, 11), 11, "monitor")).toThrow(
    "worker exceeded monitored resources",
  );
});

it.each([1, 20, 30])(
  "rejects descendants joining external group %i without changing tracking state",
  (external) => {
    const groups = new Set([11]);
    expect(() =>
      parseProcessGroup(
        `11 1 11 1\n12 11 12 1\n13 11 ${external} 1\n20 1 20 1\n30 1 30 1\n`,
        11,
        groups,
        { rootActive: true, retiredGroups: new Set(), supervisorPid: 30 },
      ),
    ).toThrow("unsafe process group");
    expect([...groups]).toEqual([11]);
  },
);

it("validates group leaders after ancestry closure independent of row order", () => {
  const groups = new Set([11]);
  expect(
    parseProcessGroup("14 13 13 1\n13 12 13 1\n12 11 12 1\n11 1 11 1\n", 11, groups).pids,
  ).toEqual([14, 13, 12, 11]);
  expect([...groups].sort()).toEqual([11, 12, 13]);
});

it("rejects root group changes without adopting that group", () => {
  const groups = new Set([11]);
  expect(() => parseProcessGroup("11 1 22 1\n22 1 22 1\n", 11, groups)).toThrow(
    "unsafe process group",
  );
  expect([...groups]).toEqual([]);
});

it("retires empty groups and never readopts a reused root PID", () => {
  const groups = new Set([11, 12]);
  const state = { rootActive: true, retiredGroups: new Set<number>(), supervisorPid: 30 };
  expect(parseProcessGroup("12 1 12 1\n", 11, groups, state).pids).toEqual([12]);
  expect([...groups]).toEqual([12]);
  expect(state.rootActive).toBe(false);
  expect([...state.retiredGroups]).toEqual([11]);
  expect(parseProcessGroup("11 1 11 1\n12 1 12 1\n", 11, groups, state).pids).toEqual([12]);
  expect([...groups]).toEqual([12]);
  parseProcessGroup("11 1 11 1\n", 11, groups, state);
  expect(groups.size).toBe(0);
  expect(parseProcessGroup("11 1 11 1\n12 1 12 1\n", 11, groups, state).pids).toEqual([]);
});

it("does not seed root ancestry after root close even before the next empty sample", () => {
  const groups = new Set([11]);
  const state = { rootActive: false, retiredGroups: new Set<number>(), supervisorPid: 30 };
  expect(parseProcessGroup("11 1 11 1\n21 11 21 1\n", 11, groups, state).pids).toEqual([]);
  expect(groups.size).toBe(0);
});

it("rejects an unknown group without a descendant leader", () => {
  const groups = new Set([11]);
  const state = { rootActive: true, retiredGroups: new Set<number>(), supervisorPid: 30 };
  expect(() => parseProcessGroup("11 1 11 1\n12 11 22 1\n", 11, groups, state)).toThrow(
    "unsafe process group",
  );
  expect([...groups]).toEqual([11]);
  expect(state.rootActive).toBe(true);
  expect(state.retiredGroups.size).toBe(0);
});

it("counts reparented members of a newly validated descendant group", () => {
  expect(parseProcessGroup("11 1 11 1\n12 11 12 1\n13 1 12 1\n14 13 14 1\n", 11).pids).toEqual([
    11, 12, 13, 14,
  ]);
});

it("refuses descendant reuse of a retired group without changing state", () => {
  const groups = new Set([11]);
  const state = { rootActive: true, retiredGroups: new Set([12]), supervisorPid: 30 };
  expect(() => parseProcessGroup("11 1 11 1\n12 11 12 1\n", 11, groups, state)).toThrow(
    "unsafe process group",
  );
  expect([...groups]).toEqual([11]);
  expect([...state.retiredGroups]).toEqual([12]);
});

it("shrinks dangerous and empty known cleanup groups even when a sample is rejected", () => {
  const groups = new Set([11, 12, 13]);
  const state = { rootActive: true, retiredGroups: new Set<number>(), supervisorPid: 30 };
  expect(() => parseProcessGroup("11 1 11 1\n30 1 12 1\n", 11, groups, state)).toThrow(
    "unsafe process group",
  );
  expect([...groups]).toEqual([11]);
  expect([...state.retiredGroups]).toEqual([12, 13]);
});

it("retires an empty group before rejecting a newly encountered external group", () => {
  const groups = new Set([11, 12]);
  const state = { rootActive: true, retiredGroups: new Set<number>(), supervisorPid: 30 };
  expect(() => parseProcessGroup("11 1 11 1\n13 11 20 1\n20 1 20 1\n", 11, groups, state)).toThrow(
    "unsafe process group",
  );
  expect([...groups]).toEqual([11]);
  expect([...state.retiredGroups]).toEqual([12]);
});

it("keeps legitimate remaining members after root close and discovers their descendants", () => {
  const groups = new Set([11, 12]);
  const state = { rootActive: false, retiredGroups: new Set<number>(), supervisorPid: 30 };
  expect(parseProcessGroup("21 1 11 1\n12 1 12 1\n22 21 22 1\n", 11, groups, state).pids).toEqual([
    21, 12, 22,
  ]);
  expect([...groups]).toEqual([11, 12, 22]);
  expect(state.rootActive).toBe(false);
});

it("retires the dangerous root group when it becomes the supervisor group", () => {
  const groups = new Set([11]);
  const state = { rootActive: true, retiredGroups: new Set<number>(), supervisorPid: 30 };
  expect(() => parseProcessGroup("11 1 11 1\n30 1 11 1\n", 11, groups, state)).toThrow(
    "unsafe process group",
  );
  expect(groups.size).toBe(0);
  expect([...state.retiredGroups]).toEqual([11]);
  expect(state.rootActive).toBe(false);
});
