import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
}

afterEach(cleanup);
