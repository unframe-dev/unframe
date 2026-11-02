import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, expect, it, vi } from "vitest";
import { changePrincipal } from "@/shared/api/session-events";
import { RoomSharing } from "./room-sharing";

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function rotationWaitingForBody() {
  const client = new QueryClient();
  clients.push(client);
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
  let markBodyStarted!: () => void;
  const bodyStarted = new Promise<void>((resolve) => {
    markBodyStarted = resolve;
  });
  const readJson = response.json.bind(response);
  vi.spyOn(response, "json").mockImplementation(() => {
    markBodyStarted();
    return readJson();
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? response : Response.json({ joinCode: "ABCD-EFGH" }),
    ),
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RoomSharing
        room={{
          id: "room-1",
          presentationId: "presentation-1",
          state: "Waiting",
          publicationFence: null,
        }}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const rotate = await screen.findByRole("button", { name: "ルームコードを更新" });
  await waitFor(() => expect(rotate).toBeEnabled());
  await user.click(rotate);
  await bodyStarted;
  const oldRotation = client
    .getMutationCache()
    .find({ mutationKey: ["room-code-rotation", "room-1"] });
  assert.isDefined(oldRotation);
  return { client, view, body, oldRotation };
}

it("does not apply an old account's rotation body or clear the new account's uncertainty", async () => {
  const { client, view, body, oldRotation } = await rotationWaitingForBody();
  view.unmount();
  changePrincipal();
  client.clear();
  client.setQueryData(["room-code", "room-1"], { joinCode: "RSTU-VWXY" });
  const currentRotation = client.getMutationCache().build(client, {
    mutationKey: ["room-code-rotation", "room-1"],
    gcTime: Infinity,
    mutationFn: async () => {
      throw new Error("The current rotation result is unknown");
    },
  });
  await currentRotation.execute(undefined).catch(() => undefined);
  await act(async () => {
    body.enqueue(new TextEncoder().encode(JSON.stringify({ joinCode: "JKLM-NPQR" })));
    body.close();
  });
  await waitFor(() => expect(oldRotation.state.status).not.toBe("pending"));
  expect(client.getQueryData(["room-code", "room-1"])).toEqual({ joinCode: "RSTU-VWXY" });
  expect(
    client.getMutationCache().findAll({ mutationKey: ["room-code-rotation", "room-1"] }),
  ).toContain(currentRotation);
});

it("does not cancel the new account's invitation read when the old response body fails", async () => {
  const { client, view, body, oldRotation } = await rotationWaitingForBody();
  view.unmount();
  changePrincipal();
  client.clear();
  let currentSignal!: AbortSignal;
  let finishRead!: (value: { joinCode: string }) => void;
  const currentRead = client
    .fetchQuery({
      queryKey: ["room-code", "room-1"],
      queryFn: ({ signal }) => {
        currentSignal = signal;
        return new Promise<{ joinCode: string }>((resolve) => {
          finishRead = resolve;
        });
      },
    })
    .catch(() => undefined);
  try {
    await act(async () => body.error(new Error("The old response body was interrupted")));
    await waitFor(() => expect(oldRotation.state.status).not.toBe("pending"));
    expect(currentSignal.aborted).toBe(false);
  } finally {
    finishRead({ joinCode: "RSTU-VWXY" });
    await currentRead;
  }
});
