import { runPresentationTui } from "./run.js";
import { runPresentationProcess } from "../process/run-presentation-process.js";
import type { PresentationTuiCommandId } from "./model.js";

const command = await new Promise<PresentationTuiCommandId | undefined>((resolve) => {
  void runPresentationTui({ onCommandSelected: resolve, onQuit: () => resolve(undefined) }).catch(
    () => resolve(undefined),
  );
});
if (command) {
  await runPresentationProcess({
    process: {
      argv: [process.argv[0]!, process.argv[1]!, command, process.cwd()],
      env: process.env,
      stdout: process.stdout,
      stderr: process.stderr,
      on: (signal, listener) => process.on(signal, listener),
      off: (signal, listener) => process.off(signal, listener),
      get exitCode() {
        return process.exitCode;
      },
      set exitCode(value) {
        process.exitCode = value;
      },
    },
  });
}
