import { expect, it } from "vitest";
import { runPresentationCli } from "@unframe/cli";

it("公開入口から不正なコマンドを拒否する", async () => {
  const result = await runPresentationCli({ args: ["not-a-command"] });
  expect(result.exitCode).not.toBe(0);
});
