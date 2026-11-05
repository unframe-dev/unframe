import { z } from "zod";
const unityOptional = <T extends z.ZodType>(schema: T) =>
  schema
    .or(z.literal(""))
    .transform((value) => (value === "" ? undefined : value))
    .optional();

const notificationSchema = z
  .object({
    kind: z.enum(["prepared", "committed", "playback", "restored", "spatial", "failed"]),
    requestId: z.string().min(1),
    sequence: unityOptional(z.string().regex(/^[1-9][0-9]*$/)),
    buildIdentity: unityOptional(z.string().min(1)),
    message: z.string().optional(),
    outcome: unityOptional(z.enum(["rejected", "failed"])),
    phase: unityOptional(z.enum(["apply", "update", "restore", "spatial"])),
  })
  .refine(
    (value) =>
      value.kind === "failed" ||
      (value.kind === "prepared" || value.kind === "committed"
        ? !!value.buildIdentity
        : !!value.sequence),
  );
export type UnityNotification = z.infer<typeof notificationSchema>;
export type UnityExchangeDiagnostic =
  | { event: "invalid-notification"; fields: string[] }
  | {
      event: "sent" | "received" | "timeout";
      method: string;
      requestId: string;
      elapsedMilliseconds: number;
    };
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
  onDiagnostic?(diagnostic: UnityExchangeDiagnostic): void;
}) {
  let disposed = false;
  const diagnose = (diagnostic: UnityExchangeDiagnostic) => {
    try {
      input.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics must not prevent acknowledgement or timeout completion.
    }
  };
  const waiters = new Set<{
    request: Request;
    finish(error?: Error, result?: string): void;
    received(): void;
  }>();
  return {
    request(request: Request): Promise<string> {
      if (disposed || request.signal?.aborted)
        return Promise.reject(new DOMException("Preview request cancelled.", "AbortError"));
      return new Promise((resolve, reject) => {
        const started = performance.now();
        const report = (event: "sent" | "received" | "timeout") =>
          diagnose({
            event,
            method: request.method,
            requestId: request.requestId,
            elapsedMilliseconds: Math.round(performance.now() - started),
          });
        const cancel = () => finish(new DOMException("Preview request cancelled.", "AbortError"));
        const finish = (error?: Error, result?: string) => {
          if (!waiters.delete(waiter)) return;
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", cancel);
          if (error) reject(error);
          else resolve(result ?? "");
        };
        const waiter = { request, finish, received: () => report("received") };
        const timeoutMilliseconds =
          input.timeoutMilliseconds ?? (request.kind === "prepared" ? 60_000 : 10_000);
        const timer = setTimeout(() => {
          report("timeout");
          finish(
            new UnityExchangeError(
              `Unity Preview ${request.method} response timed out after ${timeoutMilliseconds} ms (request ${request.requestId}).`,
            ),
          );
        }, timeoutMilliseconds);
        waiters.add(waiter);
        request.signal?.addEventListener("abort", cancel, { once: true });
        Promise.resolve()
          .then(() => {
            if (waiters.has(waiter)) {
              report("sent");
              return input.send(request.method, request.value);
            }
          })
          .catch((error: unknown) =>
            finish(error instanceof Error ? error : new Error(String(error))),
          );
      });
    },
    notify(value: unknown) {
      if (disposed) return;
      const parsed = notificationSchema.safeParse(value);
      if (!parsed.success) {
        diagnose({
          event: "invalid-notification",
          fields: parsed.error.issues.map((issue) => issue.path.join(".")),
        });
        return;
      }
      const notification: UnityNotification = parsed.data;
      let matched = false;
      for (const waiter of waiters) {
        if (waiter.request.requestId !== notification.requestId) continue;
        if (waiter.request.sequence && notification.sequence !== waiter.request.sequence) continue;
        if (notification.kind === "failed") {
          matched = true;
          waiter.received();
          waiter.finish(
            new UnityExchangeError(notification.message ?? "Unity Preview failed.", notification),
          );
        } else if (notification.kind === waiter.request.kind) {
          const result = notification.sequence ?? notification.buildIdentity;
          if (typeof result === "string" && result.length) {
            matched = true;
            waiter.received();
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
