# AGENTS.md

These rules apply to the entire repository. A more specific `AGENTS.md` in a
subdirectory, if added later, may extend or override these rules for that
subtree.

## Project Overview

Unframe is a monorepo for an MR presentation product. The repository contains:

```text
app/
├── web/       React 19 presentation editor (WIP)
├── server/    Go API server and backend logic (WIP)
└── unity/     Unity 6000.3.14f1 MR application (WIP)

lp/            SvelteKit landing page and documentation site (WIP)
docs/          Architecture, API, ADR, plan, and synchronized documentation
packages/
├── contracts/        Generated OpenAPI artifact and code generation settings
├── api-client-ts/    Generated TypeScript client and typed wrapper
├── api-client-csharp/ C# client artifact placeholder
└── config/           Shared TypeScript, Vite+, and Git hook configuration
scripts/              Development, generation, CI, and documentation scripts
```

All applications under `app/` and `lp/` are WIP. The current implementation is
not equally complete in every area:

- `app/server/` currently owns HTTP API handling, presentation and asset
  persistence, manifest assembly, and Cloudflare R2 signed URL generation, but
  remains WIP.
- Authentication, authorization, realtime synchronization, conversion
  pipelines, and background jobs are not currently implemented. Do not treat
  planned capabilities as existing behavior.
- `app/web/` is currently a small editor scaffold. Do not assume that full
  presentation CRUD or upload workflows already exist.
- `lp/` is a static SvelteKit site and remains WIP while product content is being
  developed. Its CI task runs the LP test, check, and build commands.
- `app/unity/` contains a Unity project and EditMode tests. The generated C#
  client is not currently wired into Unity; Unity uses handwritten manifest
  models under `app/unity/Assets/Scripts/ManifestDates/`.
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

- React-specific code belongs in `app/web/`.
- Go backend code belongs in `app/server/`.
- Unity and C# code belongs in `app/unity/`.
- Landing page code belongs in `lp/`.
- OpenAPI artifacts and generation settings belong in `packages/contracts/`.
- Generated TypeScript client code belongs in `packages/api-client-ts/`.
- C# client artifacts belong in `packages/api-client-csharp/` when C# generation
  is implemented.
- Shared repository configuration belongs in `packages/config/`.
- Reusable task implementations belong in `scripts/` and are exposed through
  `flake.nix`.
- Notion-synchronized documentation belongs in `docs/notion/` and is generated
  by the Notion sync task. Do not manually edit synchronized files unless the
  task explicitly requires changing the synchronization behavior.

Do not move application-specific code into `packages/` merely because it might
be reused in the future.

Within `app/server/`, preserve the existing separation of concerns:

- `internal/api/` contains HTTP and Huma API registration.
- `internal/service/` contains application and domain logic.
- `internal/db/` contains database adapters and migrations.
- `internal/db/sqlcgen/` contains generated sqlc code and must not be edited by
  hand.
- `internal/storage/` contains the object-storage abstraction and R2 adapter.

## API Contracts and Generated Code

The API contract's source of truth is the Huma operation definitions, input and
output types, and validation in `app/server/`. The committed
`packages/contracts/openapi.yaml` file is a generated artifact, not the primary
editing point.

When changing an API:

1. Update the Huma definition and related Go types in `app/server/`.
2. Run `nix run .#gen`.
3. Review the generated OpenAPI and TypeScript client changes.
4. Update manually maintained consumers, including `app/web/` and Unity model
   code where applicable.
5. Update server, client, and consumer tests.
6. Run the relevant checks and verify generated drift.

`nix run .#gen` currently regenerates:

- `packages/contracts/openapi.yaml`
- `packages/api-client-ts/src/generated/schema.d.ts`
- `app/server/internal/db/sqlcgen/`

The C# generation step is not currently implemented. Do not claim that
`packages/api-client-csharp/` or Unity are automatically regenerated until the
generator is actually connected. When the C# generator is introduced, add it to
the generation script and drift checks in the same change.

Do not manually edit generated files. Generated files should retain the notice
provided by their generator, such as `Code generated by sqlc. DO NOT EDIT.` or
the `openapi-typescript` generated-file notice.

`docs/api/openapi.json` is not currently produced by `nix run .#gen`. Do not
assume it is synchronized with the Go API. If it is retained or updated, treat
its update process explicitly and reconcile it with the current Go-generated
contract.

## Database and Migrations

The server uses Turso/libSQL in production and `modernc.org/sqlite` with an
in-memory database in tests. Migrations use goose and are embedded from
`app/server/db/migrations/`.

- Add a new migration for a schema change; do not rewrite an already applied
  migration.
- After changing SQL queried by sqlc, run `nix run .#gen` and review the
  generated `sqlcgen` diff.
- Use `nix run .#migrate` to apply migrations. This requires the documented
  Turso environment variables.
- Keep migration, repository, service, API, and test changes consistent.

## Task Execution

The official repository task entry points are Nix flake apps. The flake exposes
apps, but it does not currently expose a full `checks` output. `nix flake check`
validates the flake outputs and formatter; it does not run the application
quality gate.

Use the following commands from the repository root:

```bash
nix develop                         # Enter the pinned toolchain
nix run .#setup                      # Install pnpm dependencies and enable hooks
nix run .#gen                        # Generate OpenAPI, TS client, and sqlc code
nix run .#check                      # Full configured code quality gate
nix run .#drift                      # Regenerate and check generated-file drift
nix run .#server                     # Server check/test/build
nix run .#control-plane              # Control Plane typecheck/test/build
nix run .#web                        # Web check/test/build
nix run .#lp                         # LP test/check/build
nix run .#contracts                  # TS client typecheck/test
nix run .#server -- fix               # Server formatter/linter autofix
nix run .#control-plane -- fix        # Control Plane formatter autofix
nix run .#web -- fix                 # Web formatter autofix
nix run .#lp -- fix                  # LP formatter autofix
nix run .#contracts -- fix           # Client formatter autofix
nix run .#dev                        # Start server and LP together
nix run .#migrate                    # Apply Turso/libSQL migrations
nix run .#notion-sync                # Synchronize Notion to docs/notion/
nix flake check                      # Validate flake outputs and formatter
```

`nix run .#dev` starts only the Go server and LP. It does not start `app/web`.
Use the Web package's `dev` script separately when needed.

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
assume that every package uses Vitest or Testing Library. The current Web, LP,
and TypeScript client packages use `tsx --test`; `app/web/` is planned to migrate
to Vitest and Testing Library. The server uses Go `testing`; Unity uses the
Unity Test Framework.

Before completing code changes:

- Run `nix run .#check` for the configured repository-wide gate.
- Run narrower area checks first when iterating.
- Run `nix flake check` when changing `flake.nix`, `flake.lock`, or Nix setup.
- Run Unity EditMode/PlayMode tests in the Unity Editor for Unity behavior
  changes. The repository Unity workflow currently performs only static checks:
  `dotnet format`, PowerShell analysis, and `.meta` integrity.
- Do not describe skipped checks as passing checks.
- If a check cannot be run, report the exact command, reason, and alternative
  validation performed.

The current `nix run .#check` gate does not run Unity Editor tests or
documentation/security link checks. Those require separate validation when
relevant.

Be aware that `nix run .#drift` and `nix run .#check` stage generated targets
as part of drift detection. Inspect `git status`, `git diff`, and
`git diff --cached` before and after these commands.

## Git Hooks and Commits

Entering `nix develop` runs the shell hook that enables the repository-local
Git hooks. `nix run .#setup` also enables them explicitly. The active repository
hook path is `packages/config/githooks`.

The tracked repository hook is currently `prepare-commit-msg`. It transforms
commit messages but does not provide a reliable pre-commit formatter or staged
file validation. A Vite+ staged configuration exists, but agents must not
assume it is active unless the configured `core.hooksPath` and hook files prove
that it is active.

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
- Update `app/server/go.mod` and `go.sum` through Go tooling for Go dependencies.
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

The server currently uses environment variables including
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`. Use `app/server/.env.example` as the
template and keep real values in ignored environment files or secret storage.

When handling authentication, authorization, file conversion, external URLs,
uploaded presentation data, or database input, validate data at trust
boundaries. The current API has no authentication or authorization middleware;
do not assume that a user identity or access policy exists.

Do not log secrets, credentials, signed URLs, or sensitive user presentation
data. Preserve the existing R2 signed URL constraints, including content type,
content length, expiry, and storage-key validation.

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
