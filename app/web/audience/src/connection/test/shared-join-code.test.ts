import { expect, test } from "vitest";
import { readSharedJoinCode } from "../shared-join-code";

test("共有URLの参加コードをAPI形式で読み取る", () => {
  expect(readSharedJoinCode("#join=ABCD-EFGH")).toBe("ABCD-EFGH");
});

test.each([
  "",
  "#other=ABCD-EFGH",
  "#join=ABCD-EFGH&join=JKLM-NPQR",
  "#join=ABCD-EFGH&join=ABCD-EFGH",
  "#join=ABCDEFGH",
  "#join=abcd-efgh",
  "#join=ABCD-0123",
  "#join=ABCD-EFGH%0A",
  "#join=%E0%A4%A",
])("不正または重複した参加情報 %s からコードを渡さない", (fragment) => {
  expect(readSharedJoinCode(fragment)).toBeNull();
});
