import type { BrowserStatus } from "./browser-entry";

export function createBrowserStatusSink(write: (status: BrowserStatus) => Promise<void>) {
  let fatal: BrowserStatus | null = null;
  let pending = Promise.resolve();
  const report = (status: BrowserStatus) => {
    const value = { ...(fatal ?? status) };
    pending = pending.then(() => write(value));
    return pending;
  };
  return {
    report,
    fail(status: BrowserStatus) {
      fatal ??= { ...status, phase: "error" };
      return report(fatal);
    },
    flush: () => pending,
  };
}
