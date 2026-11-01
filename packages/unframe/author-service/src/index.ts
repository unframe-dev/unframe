import { createHash } from "node:crypto";
import {
  createSourceSnapshot,
  createReactScenePatch,
  checkAuthoringProject,
  readEditableReactScene,
  type CheckAuthoringProjectResult,
  type ReactScenePatch,
} from "@unframe/source";
import type {
  AuthorDiagnostic,
  AuthorInstance,
  BuildJob,
  ProjectSnapshot,
  SavedCommand,
  PatchRequest,
} from "@unframe/contracts/author-http";
import { createAuthorBuildService, type AuthorBuildPorts } from "@unframe/build";
export class AuthorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; reason: string }[] = [],
    readonly retryable = false,
  ) {
    super(message);
  }
}
export type AuthorService = {
  project(): Promise<ProjectSnapshot>;
  patch(revision: string, request: PatchRequest): Promise<SavedCommand>;
  build(revision: string, requestId: string, channel?: "dev" | "dist"): Promise<BuildJob>;
  job(id: string): Promise<BuildJob>;
  cancel(id: string): Promise<BuildJob>;
  artifact(id: string, assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  close(): Promise<void>;
};
export type AuthorServiceOptions = {
  artifactRetention?: { maxGenerations?: number; maxBytes?: number };
  maxCompletedJobs?: number;
};
export type AuthorServicePorts = {
  initialize(): Promise<void>;
  withSource<T>(
    callback: () => Promise<T>,
    allowRecovery: boolean,
    waitTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T>;
  project(): Promise<ProjectSnapshot>;
  patch(revision: string, request: PatchRequest): Promise<SavedCommand>;
  prepareBuild(
    revision: string,
    channel: "dev" | "dist",
  ): Promise<{ revision: string; snapshot: ProjectSnapshot }>;
  run: AuthorBuildPorts["run"];
  readPublishedArtifacts(
    generation: string,
    instances: readonly string[],
    channel: "dev" | "dist",
    maxBytes?: number,
  ): Promise<{
    catalog: BuildJob["artifacts"];
    assets: Map<string, { bytes: Uint8Array; mediaType: string }>;
  }>;
};
export function createAuthorPatch(input: {
  source: unknown;
  sourceText: string;
  entryFile: string;
  snapshot: ProjectSnapshot;
  revision: string;
  request: PatchRequest;
}): ReactScenePatch {
  if (
    input.snapshot.revision !== input.revision ||
    input.snapshot.irHash !== input.request.expectedIrHash
  )
    fail(412, "author-revision-mismatch", "Project revision or IR changed.");
  if (!input.snapshot.irHash)
    fail(422, "author-source-invalid", "Project source cannot be edited.");
  if (input.snapshot.instances.length === 0)
    fail(422, "author-edit-unsupported", "Project source does not support Inspector edits.");
  const snapshot = createSourceSnapshot(input.source);
  if (!snapshot.ok) fail(422, "author-source-invalid", "Project source cannot be snapshotted.");
  const patched = createReactScenePatch({
    snapshot: snapshot.value,
    fileName: input.entryFile,
    targetHash: `sha256:${digest(encoder.encode(input.sourceText))}`,
    command: input.request.command,
  });
  if (!patched.ok)
    fail(
      422,
      patched.diagnostics[0]?.code ?? "author-edit-unsupported",
      patched.diagnostics[0]?.message ?? "Edit is unsupported.",
    );
  return patched.value;
}
function fail(status: number, code: string, message: string): never {
  throw new AuthorError(status, code, message);
}
const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const createAuthorService = async (
  ports: AuthorServicePorts,
  options: AuthorServiceOptions = {},
): Promise<AuthorService> => {
  await ports.initialize();
  let closed = false;
  const withSource: AuthorServicePorts["withSource"] = (callback, recovery, timeout, signal) => {
    if (closed) fail(409, "author-service-closed", "Author host is closed.");
    return ports.withSource(
      async () => {
        if (closed) fail(409, "author-service-closed", "Author host is closed.");
        return callback();
      },
      recovery,
      timeout,
      signal,
    );
  };
  const builds = createAuthorBuildService({ ...ports, withSource, fail }, options);
  return {
    project: () => withSource(ports.project, false, 5000),
    patch: (revision, request) =>
      withSource(
        async () => {
          const saved = await ports.patch(revision, request);
          builds.invalidate();
          return saved;
        },
        true,
        0,
      ),
    build: builds.build,
    job: builds.job,
    cancel: builds.cancel,
    artifact: builds.artifact,
    close: async () => {
      closed = true;
      await builds.close();
    },
  };
};

export type AuthorSourceInspection = {
  catalog: CheckAuthoringProjectResult;
  instances: AuthorInstance[];
  diagnostics: AuthorDiagnostic[];
};
export function inspectAuthorSource(input: {
  source: unknown;
  sourceText: string;
  semanticValid: boolean;
}): AuthorSourceInspection {
  const catalog = checkAuthoringProject(input.source);
  const diagnostics: AuthorDiagnostic[] = !catalog.valid
    ? catalog.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        family:
          item.code === "compiler-source-syntax-error" ||
          item.code === "compiler-source-kind-unsupported" ||
          item.code.startsWith("compiler-static-")
            ? "syntax"
            : item.code === "compiler-source-type-error" ||
                item.code.startsWith("compiler-module-") ||
                item.code === "compiler-project-entry-invariant-invalid"
              ? "type"
              : "semantic",
        path: item.fileName ? [item.fileName] : [],
        ...(item.fileName
          ? {
              location: {
                fileName: item.fileName,
                start: item.start,
                end: item.end,
                line: item.line,
                column: item.column,
              },
            }
          : {}),
      }))
    : [];
  const editable =
    catalog.valid && input.semanticValid
      ? readEditableReactScene(catalog.value, input.sourceText)
      : undefined;
  if (editable && !editable.ok)
    diagnostics.push(
      ...editable.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: item.instanceId ? [item.instanceId] : [],
      })),
    );
  const instances = editable?.ok
    ? editable.value.map((item) => ({
        instanceId: item.instanceId,
        surfaceId: surfaceIdFor(item.instanceId),
        props: Object.fromEntries(
          Object.entries(item.props).map(([id, prop]) => [
            id,
            {
              type: prop.kind,
              value: prop.value,
              editable: prop.editable,
              inherited: prop.inherited,
              ...(prop.editor ? { editor: prop.editor } : {}),
              ...(prop.inheritanceExpression
                ? { inheritanceExpression: prop.inheritanceExpression }
                : {}),
            },
          ]),
        ),
        transform: {
          position: [...item.transform.position] as [number, number, number],
          rotation: [...item.transform.rotation] as [number, number, number, number],
          scale: [...item.transform.scale] as [number, number, number],
        },
        transformEditable: item.transformEditable,
        transformInherited: item.transformInherited,
        ...(item.transformInheritanceExpression
          ? { transformInheritanceExpression: item.transformInheritanceExpression }
          : {}),
      }))
    : [];
  return { catalog, instances, diagnostics };
}
export const surfaceIdFor = (instanceId: string) =>
  "r:" + digest(encoder.encode(JSON.stringify(["react-component-v1", "surface", instanceId, ""])));
