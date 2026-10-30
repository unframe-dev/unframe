# AGENTS.md

These rules apply to the entire repository. A more specific `AGENTS.md` in a
subdirectory, if added later, may extend or override these rules for that
subtree.

## Project Overview

Unframe is a monorepo for an MR presentation product. The repository contains:

```text
app/
├── web/
│   ├── console/      React 19 management SPA (WIP)
│   ├── local-editor/ Local Source editor / Unity Preview (WIP)
│   └── audience/     React / 8th Wall / Three.js audience viewer
├── server/    Control Plane and Realtime Backend (WIP)
└── unity/     Unity 6000.3.22f1 MR application (WIP)

lp/            SvelteKit landing page and documentation site (WIP)
docs/          Architecture, API, ADR, and plan documentation
packages/
├── contracts/        API and protocol contracts / generated artifacts
├── api-client-csharp/ Generated C# Control Plane / Realtime artifacts
└── config/           Shared TypeScript, Vite+, and Git hook configuration
scripts/              Development, generation, CI, and documentation scripts
```

All applications under `app/` and `lp/` are WIP. The current implementation is
not equally complete in every area:

- The legacy Go/Huma/Turso/R2 HTTP backend has been removed. The Control Plane
  implements authentication, Presentation / Asset APIs, Session lifecycle,
  Venue Edge assignment, and Realtime bootstrap. The independent Go Realtime
  process implements authenticated v3 Control / State over gRPC and browser
  WebSocket, assignment fencing, Runtime snapshots, and replay / resume.
  See `app/server/realtime/ARCHITECTURE.md` for Runtime and persistence boundaries.
- Conversion pipelines and background jobs are not currently implemented. Do
  not treat planned capabilities as existing behavior.
- `app/web/console/` owns authentication, published Dist inspection, and Session creation.
  `app/web/local-editor/` owns Source editing, Unity Preview, and CLI-mediated publication.
  Each application under `app/web/` has independent dependencies, build, and startup configuration.
- `lp/` is a static SvelteKit site and remains WIP while product content is being
  developed. Its CI task runs the LP test, check, and build commands.
- `app/unity/` contains a Unity project and EditMode tests. The generated Control Plane C# client is not wired into Unity. Unity uses generated Realtime clients and Delivery Protobuf types under `app/unity/Assets/Scripts/PresentationRuntime/Generated/`.
- There is currently no deployment workflow in this repository. Do not invent
  deployment commands or assume that an application is independently deployed.

Use `ARCHITECTURE.md` for the intended target architecture, but verify target
claims against the implementation, scripts, and CI before relying on them.

## General Principles

- Make the smallest change necessary to satisfy the task.
- The project is under active development. Do not avoid necessary breaking
  changes solely to preserve compatibility with unfinished behavior; prefer a
  clean and correct design.
- Preserve existing architecture and naming conventions.
- Do not introduce new abstractions without a concrete current use case.
- Do not perform unrelated refactoring while implementing a requested change.
- Prefer explicit and readable code over clever code.
- Keep state and logic separate where the existing component boundaries support
  that separation.
- Do not assume that code shared across React, Svelte, Go, and Unity should use
  the same implementation.
- Treat API contracts and generated artifacts as cross-application interfaces.
- Do not discard, reset, or overwrite changes made by the user or another
  contributor.
- Do not commit or push unless the user explicitly requests it.

## Comments

Comments must explain information that cannot be understood from the code
itself.

Acceptable comments include:

- Why a non-obvious implementation was chosen
- Why a workaround is required
- External constraints or platform-specific behavior
- Important invariants
- Security or compatibility considerations

Do not add comments that describe the implementation process, task plan,
prompt history, or development phase.

The following types of comments are prohibited:

```text
// Added according to phase 4 of the plan.
// This was implemented as requested.
// Step 3: initialize the client.
// TODO from the original task.
// We use this because the previous agent decided to.
```

Do not reference:

- Task numbers
- Prompt instructions
- Implementation plans
- Conversation history
- Agent decisions
- Temporary reasoning
- Phases or steps from a generated plan

Bad:

```ts
// Phase 4 of the plan requires us to validate the response.
validateResponse(response);
```

Good:

```ts
// Validate at the boundary because Unity clients may continue using older schemas.
validateResponse(response);
```

Do not comment obvious code. Prefer meaningful names and simpler code instead
of explanatory comments.

## Repository Boundaries

Keep changes within the owning application unless a cross-application change is
necessary.

- Management Web code belongs in `app/web/console/`; local Source editor code belongs in `app/web/local-editor/`.
- Audience-specific React, tracking, calibration, and Three.js code belongs in `app/web/audience/`. Anonymous Viewer participation and browser Runtime reception are implemented; public-environment and device acceptance remain unverified.
- Go backend code belongs in `app/server/`.
- Unity and C# code belongs in `app/unity/`.
- Landing page code belongs in `lp/`.
- Shared API and protocol contracts belong in `packages/contracts/`.
- C# client artifacts belong in `packages/api-client-csharp/` when C# generation
  is implemented.
- Shared repository configuration belongs in `packages/config/`.
- Reusable task implementations belong in `scripts/` and are exposed through
  `flake.nix`.

Do not move application-specific code into `packages/` merely because it might
be reused in the future.

Within `app/server/`, keep Control Plane (`control-plane/`) and Realtime
(`realtime/`) as independent runtime, dependency, and deployment units. Share
contracts, not implementation code.

Within `app/server/realtime/`, preserve the target Realtime Backend boundaries:

- `internal/transport/grpc/` contains the handwritten gRPC transport adapter.
- `internal/auth/` contains connection and service identity verification.
- `internal/protocol/` maps generated wire types to validated core inputs.
- `internal/runtimecore/` contains infrastructure-independent canonical state and execution logic.
- `internal/session/` contains authenticated identities and State nonce primitives.
- `internal/persistence/http/` contains the Control Plane HTTP adapter.
- `internal/gen/` is reserved for generated code and must not contain handwritten Go code.

## API Contracts and Generated Code

Control Plane OpenAPI is generated from `app/server/control-plane/src/openapi.ts` into `packages/contracts/`. Realtime Protocol Buffers are defined under `packages/contracts/proto/`. Use the existing generation and drift commands to synchronize consumers.

Do not manually edit generated files. Distinguish Control Plane C# client integration from the generated Realtime Protobuf clients used by Unity.

## Database and Migrations

The legacy Turso/libSQL schema and migrations were removed with the old HTTP
backend. Define D1 migrations with the Control Plane implementation. Add a new
migration for a schema change and keep migration, repository, service, API,
and test changes consistent.

## Task Execution

The official repository task entry points are Nix flake apps. The flake exposes
apps, but it does not currently expose a full `checks` output. `nix flake check`
validates the flake outputs and formatter; it does not run the application
quality gate.

Use the following commands from the repository root:

```bash
nix develop                         # Enter the pinned toolchain
nix run .#setup                      # Install pnpm dependencies and enable hooks
nix run .#check                      # Full configured code quality gate
nix run .#control-plane              # Control Plane typecheck/test/build
nix run .#realtime                   # Realtime vet/lint/test/build/race
nix run .#console                    # Console check/test/build
nix run .#local-editor               # Local Editor check/test/build
nix run .#audience                   # Audience check/test/build
nix run .#audience -- dev            # Audience development server
nix run .#audience -- preview        # Audience production build preview
nix run .#audience -- fix            # Audience formatter autofix
nix run .#lp                         # LP test/check/build
nix run .#control-plane -- fix       # Control Plane formatter autofix
nix run .#realtime -- fix             # Realtime formatter/linter autofix
nix run .#console -- fix             # Console formatter autofix
nix run .#lp -- fix                  # LP formatter autofix
nix flake check                      # Validate flake outputs and formatter
```

Component-specific check, fix, development, migration, and deployment commands
belong to the relevant component once that component exists. Do not assume a
repository-wide backend command.

Use pnpm for JavaScript workspace operations. Do not introduce npm, yarn, or a
new task runner for routine repository commands. Do not add Just, Make, Task,
mise, or another repository-wide runner without an explicit architectural
decision.

Complex task logic belongs in `scripts/`; `flake.nix` should provide the
environment, public task name, and connection to the script rather than
duplicating task logic.

## Test-Driven Development and Validation

Feature additions and bug fixes follow this cycle by default:

```text
Explore -> Red -> Green -> Refactor
```

Write a failing test that describes the behavior, implement the smallest
solution, then refactor while keeping the tests green. Exceptions are allowed
for exploratory work where a test is not yet meaningful and for Unity visual or
device experiments. Record the limitation when an exception is used.

The package scripts are the authority for JavaScript test commands. Do not
assume that every package uses Vitest or Testing Library. The current Web and
LP packages use their package scripts; Unity uses the Unity Test Framework.

Before completing code changes:

- Run `nix run .#check` for the configured repository-wide gate.
- Run narrower area checks first when iterating.
- Run `nix flake check` when changing `flake.nix`, `flake.lock`, or Nix setup.
- Run the existing Unity EditMode tests in the Unity Editor for Unity behavior
  changes, and any relevant PlayMode tests if they are added. The repository
  `unity.yml` performs static format, protobuf/dependency drift, and `.meta`
  checks. Run actual Unity / Audience synchronization and recovery locally with
  `nix run .#realtime-e2e -- --unity --race` when a licensed Unity Editor is available;
  the static CI checks do not validate Unity behavior.
- Do not describe skipped checks as passing checks.
- If a check cannot be run, report the exact command, reason, and alternative
  validation performed.

The current `nix run .#check` gate does not run Unity Editor tests or
documentation/security link checks. Those require separate validation when
relevant.

Inspect `git status`, `git diff`, and `git diff --cached` before and after
quality commands that may produce generated artifacts.

## Git Hooks and Commits

Entering `nix develop` runs the shell hook that enables the repository-local
Git hooks. `nix run .#setup` also enables them explicitly. The active repository
hook path is `packages/config/githooks`.

The tracked `pre-commit` hook runs `pnpm exec vp staged` from the repository
root, applying the configured Vite+ checks and formatting to staged files.
`prepare-commit-msg` transforms commit messages. Confirm `core.hooksPath` and
the installed hook files before relying on these checks, and inspect the
resulting staged diff because hooks can modify it.

The current commit-message behavior includes:

```text
feat(server): add endpoint       -> ✨ server: add endpoint
gm feat(server): add endpoint    -> feat(server): ✨ add endpoint
n feat(server): add endpoint     -> feat(server): add endpoint
```

Do not bypass repository hooks without an explicit request. Follow the
repository's existing commit convention rather than inventing a new one. The
hook does not itself enforce Conventional Commits, commit scopes, Japanese
descriptions, or release metadata.

Unless the user explicitly asks for a commit, leave changes uncommitted. Before
any requested commit, run the relevant lint checks and ensure they pass, then
inspect the worktree and staged diff. After committing, inspect the resulting
commit and status because hooks or automation may alter the commit message.

## Dependencies

Before adding a dependency:

- Confirm that the existing stack does not already solve the problem.
- Prefer actively maintained dependencies.
- Avoid adding a dependency for trivial functionality.
- Add it only to the package or application that uses it.
- Use pnpm for JavaScript dependencies and update `pnpm-lock.yaml` through the
  package manager.
- Update the owning Go module's `go.mod` and `go.sum` through Go tooling. The
  current modules are `app/server/` and `app/server/realtime/`.
- Update `app/unity/Packages/manifest.json` and `packages-lock.json` through the
  Unity Package Manager for Unity dependencies.
- Run the relevant type, test, lint, and build checks.

Do not commit generated Unity solution/project files (`.sln`, `.csproj`) or
Unity cache/build directories. Do not add repository-wide dependencies for one
application.

## Documentation

Update documentation when a change affects:

- Architecture or ownership boundaries
- Public APIs or generated contracts
- Database schema or migration procedures
- Environment variables
- Development setup or repository commands
- Build, CI, or deployment procedures
- User-visible behavior

For current repository guidance, prefer:

- `ARCHITECTURE.md` for the intended target architecture
- `CONTRIBUTING.md` for project workflow and collaboration rules
- `app/server/README.md` for server environment and smoke tests
- `scripts/README.md` for task entry points
- `docs/decisions/` for accepted architectural decisions

Treat `docs/plans/` as historical implementation records, not automatically as
current specifications. Resolve stale API documentation before using it as an
implementation source; older files may refer to the previous Hono,
Cloudflare/Supabase, or `apps/*` layout.

Documentation must describe the current system or clearly label planned and
follow-up work. Do not document future behavior as if it already exists.

## Security

Never commit:

- Secrets
- API keys
- Tokens
- Private certificates
- Production credentials
- Personal environment files

When handling authentication, authorization, file conversion, external URLs,
uploaded presentation data, or database input, validate data at trust
boundaries. The Control Plane has session-based identity and resource permission
checks, and Realtime verifies connection identity and assignment. Check the
policy at each route or transport boundary; do not assume every caller is
authenticated or authorized.

Do not log secrets, credentials, signed URLs, or sensitive user presentation
data.

## Completion Criteria

A task is complete only when:

- The requested behavior is implemented.
- The change follows the owning application's conventions and current layer
  boundaries.
- Relevant tests are added or updated, normally through TDD.
- Relevant local checks pass.
- Generated code is synchronized when applicable.
- Database migrations are added when the schema changes.
- Documentation is updated when necessary.
- No unrelated files or user changes are modified.
- The final worktree and staged diff have been reviewed.
- Any limitation, skipped check, or known mismatch is explicitly reported.
