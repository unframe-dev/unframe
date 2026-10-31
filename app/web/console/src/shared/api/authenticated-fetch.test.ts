import { afterEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "./authenticated-fetch";
import { changePrincipal, notifySessionChanged, subscribeSessionChanges } from "./session-events";

afterEach(() => vi.unstubAllGlobals());

it("notifies session consumers when a protected request loses authentication", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  const events: string[] = [];
  const unsubscribe = subscribeSessionChanges((event) => events.push(event.reason));
  try {
    await authenticatedFetch("https://api.example.test/presentations");
    expect(events).toEqual(["unauthorized"]);
  } finally {
    unsubscribe();
  }
});

it("does not treat an incorrect login password as an expired session", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  const events: string[] = [];
  const unsubscribe = subscribeSessionChanges((event) => events.push(event.reason));
  try {
    await authenticatedFetch("https://api.example.test/api/auth/sign-in/email", { method: "POST" });
    expect(events).toEqual([]);
  } finally {
    unsubscribe();
  }
});

it("rechecks the session after a protected authentication operation returns 401", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  const events: string[] = [];
  const unsubscribe = subscribeSessionChanges((event) => events.push(event.reason));
  try {
    await authenticatedFetch("https://api.example.test/api/auth/update-user", { method: "POST" });
    expect(events).toEqual(["changed"]);
  } finally {
    unsubscribe();
  }
});

it("ignores an old unauthorized response after authentication has changed", async () => {
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const events: string[] = [];
  const unsubscribe = subscribeSessionChanges((event) => events.push(event.reason));
  try {
    const request = authenticatedFetch("https://api.example.test/presentations");
    notifySessionChanged();
    respond(new Response(null, { status: 401 }));
    await request;
    expect(events).toEqual(["changed"]);
  } finally {
    unsubscribe();
  }
});

it("discards a successful response from the previous account", async () => {
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const request = authenticatedFetch("https://api.example.test/presentations");
  changePrincipal();
  respond(new Response("previous account data"));
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
