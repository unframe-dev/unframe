import { runPresentationProcess } from "./run-presentation-process.js";

void runPresentationProcess({ process }).catch(() => {
  process.exitCode = 3;
});
