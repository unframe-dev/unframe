import { describe, expect, it } from "vitest";
import { managementErrorMessage, mapConcurrent } from "./management-model";

describe("management failures", () => {
  it.each([
    [401, "ログインの有効期限が切れました。ログインし直してください。"],
    [403, "この情報を参照・操作する権限がありません。"],
    [409, "公開済み Dist がないか、公開状態が変更されています。公開情報を再取得してください。"],
  ])("distinguishes HTTP %s", (status, message) => {
    expect(managementErrorMessage({ status })).toBe(message);
  });
  it("does not label a network failure as unpublished", () => {
    expect(managementErrorMessage(new TypeError("network"))).toContain("通信に失敗");
  });
});

it("bounds simultaneous publication requests and retains input order", async () => {
  let active = 0;
  let maximum = 0;
  const values = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return value * 2;
  });
  expect(maximum).toBe(2);
  expect(values).toEqual([2, 4, 6, 8, 10]);
});
