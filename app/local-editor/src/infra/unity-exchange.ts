import { z } from "zod";
const notificationSchema = z
  .object({
    kind: z.enum(["prepared", "committed", "playback", "restored", "failed"]),
    requestId: z.string().min(1),
    sequence: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    buildIdentity: z.string().min(1).optional(),
    message: z.string().optional(),
    outcome: z.enum(["rejected", "failed"]).optional(),
    phase: z.enum(["apply", "update", "restore"]).optional(),
  })
  .refine(
    (value) =>
      value.kind === "failed" ||
      (value.kind === "prepared" || value.kind === "committed"
        ? !!value.buildIdentity
        : !!value.sequence),
  );
export type UnityNotification = z.infer<typeof notificationSchema>;
export class UnityExchangeError extends Error {
  constructor(
    message: string,
    readonly notification?: UnityNotification,
  ) {
    super(message);
  }
}
type Request = {
  requestId: string;
  kind: Exclude<UnityNotification["kind"], "failed">;
  method: string;
  value: string;
  sequence?: string;
  signal?: AbortSignal;
};
export function createUnityExchange(input: {
  send(method: string, value: string): void | Promise<void>;
  timeoutMilliseconds?: number;
  onFailure?(notification: UnityNotification): void;
}) {
  let disposed = false;
  const waiters = new Set<{ request: Request; finish(error?: Error, result?: string): void }>();
  return {
    request(request: Request): Promise<string> {
      if (disposed || request.signal?.aborted)
        return Promise.reject(new DOMException("Preview request cancelled.", "AbortError"));
      return new Promise((resolve, reject) => {
        const cancel = () => finish(new DOMException("Preview request cancelled.", "AbortError"));
        const finish = (error?: Error, result?: string) => {
          if (!waiters.delete(waiter)) return;
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", cancel);
          if (error) reject(error);
          else resolve(result ?? "");
        };
        const waiter = { request, finish };
        const timer = setTimeout(
          () => finish(new UnityExchangeError("Unity Preview response timed out.")),
          input.timeoutMilliseconds ?? 10000,
        );
        waiters.add(waiter);
        request.signal?.addEventListener("abort", cancel, { once: true });
        Promise.resolve()
          .then(() => {
            if (waiters.has(waiter)) return input.send(request.method, request.value);
          })
          .catch((error: unknown) =>
            finish(error instanceof Error ? error : new Error(String(error))),
          );
      });
    },
    notify(value: unknown) {
      if (disposed) return;
      const parsed = notificationSchema.safeParse(value);
      if (!parsed.success) return;
      const notification: UnityNotification = parsed.data;
      let matched = false;
      for (const waiter of waiters) {
        if (waiter.request.requestId !== notification.requestId) continue;
        if (waiter.request.sequence && notification.sequence !== waiter.request.sequence) continue;
        if (notification.kind === "failed") {
          matched = true;
          waiter.finish(
            new UnityExchangeError(notification.message ?? "Unity Preview failed.", notification),
          );
        } else if (notification.kind === waiter.request.kind) {
          const result = notification.sequence ?? notification.buildIdentity;
          if (typeof result === "string" && result.length) {
            matched = true;
            waiter.finish(undefined, result);
          }
        }
      }
      if (!matched && notification.kind === "failed") input.onFailure?.(notification);
    },
    invalidate() {
      for (const waiter of waiters)
        waiter.finish(new DOMException("Preview request superseded.", "AbortError"));
    },
    dispose() {
      disposed = true;
      for (const waiter of waiters)
        waiter.finish(new DOMException("Unity Preview closed.", "AbortError"));
    },
  };
}
