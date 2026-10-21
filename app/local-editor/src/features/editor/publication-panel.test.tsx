import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EditorApiError, type PublicationAuth } from "./api";
import { PublicationPanel, type PublicationApi } from "./publication-panel";

const receipt = { requestId: "display", buildIdentity: "build" };
const setup = (): PublicationApi => ({
  publicationAuth: vi.fn(async () => ({ status: "authenticated" as const })),
  beginPublicationAuth: vi.fn(),
  cancelPublicationAuth: vi.fn(),
  publish: vi.fn(async () => ({ ok: true as const, buildId: "build", publicationEpoch: 1 })),
});

it("publishes only a committed Dist receipt and disables publication after invalidation", async () => {
  const api = setup();
  const view = render(<PublicationPanel api={api} receipt={null} />);
  const button = await screen.findByRole("button", { name: "表示した Dist を公開" });
  expect(button).toBeDisabled();
  view.rerender(<PublicationPanel api={api} receipt={receipt} />);
  expect(button).toBeEnabled();
  await userEvent.setup().click(button);
  await screen.findByText(/公開完了: build/);
  expect(api.publish).toHaveBeenCalledWith("display");
  expect(button).toBeDisabled();
  view.rerender(<PublicationPanel api={api} receipt={null} />);
  expect(button).toBeDisabled();
});

it("shows the public device code and supports cancellation without publishing", async () => {
  const api = setup();
  let auth: PublicationAuth = { status: "signed-out" };
  vi.mocked(api.publicationAuth).mockImplementation(async () => auth);
  vi.mocked(api.beginPublicationAuth).mockImplementation(async () => {
    auth = {
      status: "pending",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://web.example/device?user_code=ABCD-EFGH",
    };
    return auth;
  });
  vi.mocked(api.cancelPublicationAuth).mockImplementation(async () => {
    auth = { status: "signed-out" };
  });
  render(<PublicationPanel api={api} receipt={receipt} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "公開の認証を開始" }));
  expect(await screen.findByText("確認コード: ABCD-EFGH")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "認証ページを開く" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await user.click(screen.getByRole("button", { name: "認証を取り消す" }));
  await waitFor(() => expect(screen.queryByText(/確認コード:/)).not.toBeInTheDocument());
  expect(api.publish).not.toHaveBeenCalled();
});

it("reports publication conflicts without automatically retrying", async () => {
  const api = setup();
  vi.mocked(api.publish).mockRejectedValue(
    new EditorApiError(409, "publication-conflict", "別の公開が先行しました。"),
  );
  render(<PublicationPanel api={api} receipt={receipt} />);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "表示した Dist を公開" }));
  expect(await screen.findByRole("status")).toHaveTextContent("公開失敗: 別の公開が先行しました。");
  expect(api.publish).toHaveBeenCalledTimes(1);
});
