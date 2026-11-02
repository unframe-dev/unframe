import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  patchEditableReactScene,
  type ReactSceneEditCommand,
  type ReactSceneEditDiagnostic,
} from "./react-scene-source.js";
import { parseAuthoringProject } from "../project/parse-authoring-project.js";
import { checkParsedAuthoringProject } from "../api/check-authoring-project.js";
import { createSourceSnapshot, type SourceSnapshot } from "../project/source-snapshot.js";

export type ReactScenePatch = {
  readonly snapshotId: string;
  readonly fileName: string;
  readonly targetHash: string;
  readonly sourceText: string;
};

export const createReactScenePatch = (input: {
  readonly snapshot: SourceSnapshot;
  readonly fileName: string;
  readonly targetHash: string;
  readonly command: ReactSceneEditCommand;
}):
  | { readonly ok: true; readonly value: ReactScenePatch; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly ReactSceneEditDiagnostic[] } => {
  const snapshot = createSourceSnapshot(input.snapshot.source);
  if (!snapshot.ok)
    return {
      ok: false,
      diagnostics: [
        {
          code: "source-snapshot-invalid",
          message: "A valid fixed Source snapshot and its identity are required.",
        },
      ],
    };
  if (snapshot.value.id !== input.snapshot.id)
    return {
      ok: false,
      diagnostics: [
        {
          code: "source-snapshot-hash-mismatch",
          message: "The snapshot does not match its content identity.",
        },
      ],
    };
  const parsed = parseAuthoringProject(snapshot.value.source);
  if (!parsed.ok)
    return {
      ok: false,
      diagnostics: [
        { code: "source-snapshot-invalid", message: "A valid fixed Source snapshot is required." },
      ],
    };
  const source = parsed.value.files[input.fileName];
  if (!source || input.fileName !== parsed.value.entryFile)
    return {
      ok: false,
      diagnostics: [
        {
          code: "source-target-invalid",
          message: "The target must be the snapshot presentation entry file.",
        },
      ],
    };
  const actualHash = `sha256:${bytesToHex(sha256(new TextEncoder().encode(source.text)))}`;
  if (actualHash !== input.targetHash)
    return {
      ok: false,
      diagnostics: [
        {
          code: "source-target-hash-mismatch",
          message: "The target source does not match its expected hash.",
        },
      ],
    };
  const checked = checkParsedAuthoringProject(parsed.value);
  if (!checked.valid)
    return {
      ok: false,
      diagnostics: checked.diagnostics.map(({ code, message }) => ({ code, message })),
    };
  const result = patchEditableReactScene(checked.value, source.text, input.command);
  return result.ok
    ? {
        ok: true,
        value: {
          snapshotId: input.snapshot.id,
          fileName: input.fileName,
          targetHash: input.targetHash,
          sourceText: result.value,
        },
        diagnostics: [],
      }
    : result;
};
