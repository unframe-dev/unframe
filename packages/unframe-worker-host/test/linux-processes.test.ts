import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { verifyMembership } from "../src/linux-processes.js";
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
const missing = () => Object.assign(new Error("process disappeared"), { code: "ENOENT" });
const gone = () => Object.assign(new Error("process exited"), { code: "ESRCH" });
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(readFileSync).mockReset();
});
const tree = (childError: Error) => {
  vi.mocked(readFileSync).mockImplementation((path) => {
    if (path === "/proc/42/cgroup") return "0::/capture\n";
    if (path === "/proc/42/task/42/children") return "43";
    if (path === "/proc/43/task/43/children") return "";
    throw childError;
  });
};
describe("Linux process membership", () => {
  it("accepts live descendants in the capture cgroup", () => {
    vi.mocked(readFileSync).mockImplementation((path) =>
      String(path).endsWith("/cgroup")
        ? "0::/capture\n"
        : path === "/proc/42/task/42/children"
          ? "43"
          : "",
    );
    expect(() => verifyMembership(42, "/capture")).not.toThrow();
  });
  it("does not treat permission to signal as proof of exit", () => {
    tree(missing());
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    });
    expect(() => verifyMembership(42, "/capture")).toThrow();
  });
  it("rejects other proc I/O errors even when a descendant exited", () => {
    tree(Object.assign(new Error("I/O failure"), { code: "EIO" }));
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw gone();
    });
    expect(() => verifyMembership(42, "/capture")).toThrow();
  });
  it("rejects malformed membership", () => {
    vi.mocked(readFileSync).mockReturnValue("invalid");
    expect(() => verifyMembership(42, "/capture")).toThrow("membership");
  });
  it("rejects malformed descendant identifiers", () => {
    vi.mocked(readFileSync).mockImplementation((path) =>
      String(path).endsWith("/cgroup") ? "0::/capture\n" : "invalid",
    );
    expect(() => verifyMembership(42, "/capture")).toThrow("descendants");
  });
  it("accepts a descendant that exited after enumeration", () => {
    tree(missing());
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw gone();
    });
    expect(() => verifyMembership(42, "/capture")).not.toThrow();
  });
  it("rejects an inaccessible descendant that is still alive", () => {
    tree(missing());
    vi.spyOn(process, "kill").mockReturnValue(true);
    expect(() => verifyMembership(42, "/capture")).toThrow();
  });
  it("rejects permission errors even when a descendant exited", () => {
    tree(Object.assign(new Error("denied"), { code: "EACCES" }));
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw gone();
    });
    expect(() => verifyMembership(42, "/capture")).toThrow();
  });
  it.each([true, false])(
    "requires process exit when a descendant task directory disappears (exited=%s)",
    (hasExited) => {
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).endsWith("/cgroup")) return "0::/capture\n";
        if (path === "/proc/42/task/42/children") return "43";
        throw missing();
      });
      vi.spyOn(process, "kill").mockImplementation(() => {
        if (hasExited) throw gone();
        return true;
      });
      if (hasExited) expect(() => verifyMembership(42, "/capture")).not.toThrow();
      else expect(() => verifyMembership(42, "/capture")).toThrow();
    },
  );
  it.each(["cgroup", "children"])(
    "rejects an exited root worker with a missing %s entry",
    (entry) => {
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (entry === "children" && path === "/proc/42/cgroup") return "0::/capture\n";
        throw missing();
      });
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw gone();
      });
      expect(() => verifyMembership(42, "/capture")).toThrow();
    },
  );
  it("still verifies live siblings after a descendant exits", () => {
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (path === "/proc/42/cgroup") return "0::/capture\n";
      if (path === "/proc/42/task/42/children") return "44 43";
      if (path === "/proc/43/cgroup") throw missing();
      if (path === "/proc/44/cgroup") return "0::/outside\n";
      return "";
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw gone();
    });
    expect(() => verifyMembership(42, "/capture")).toThrow("escaped");
  });
  it("rejects a live descendant outside the capture cgroup", () => {
    tree(missing());
    vi.mocked(readFileSync).mockImplementation((path) =>
      path === "/proc/42/cgroup"
        ? "0::/capture\n"
        : path === "/proc/42/task/42/children"
          ? "43"
          : path === "/proc/43/cgroup"
            ? "0::/outside\n"
            : "",
    );
    expect(() => verifyMembership(42, "/capture")).toThrow("escaped");
  });
});
