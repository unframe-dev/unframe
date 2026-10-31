import { afterEach, expect, it, vi } from "vitest";
import { changePrincipal } from "@/shared/api/session-events";
import { updateProfileImage } from "./profile-image-api";

afterEach(() => vi.unstubAllGlobals());

it("discards an image upload response after the signed-in account changes", async () => {
  let respond!: (response: Response) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
        started();
      }),
  );
  const saving = updateProfileImage(new Blob(["cropped image"], { type: "image/png" }));
  await requestStarted;
  changePrincipal();
  respond(
    Response.json({ image: "https://api.example.test/user-images/previous-account/image.png" }),
  );
  await expect(saving).rejects.toMatchObject({ name: "AbortError" });
});
