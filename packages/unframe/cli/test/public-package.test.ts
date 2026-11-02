import { expect, it } from "vite-plus/test";
import { runPresentationCli } from "@unframe/cli";

it("公開入口から不正なコマンドを拒否する", async () => {
  const result = await runPresentationCli({ args: ["not-a-command"] });
  expect(result.exitCode).not.toBe(0);
});
