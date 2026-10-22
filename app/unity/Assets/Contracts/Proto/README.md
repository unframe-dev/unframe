# Presentation Runtime protobuf inputs

The source of truth is `packages/contracts/proto/`. These Unity `.proto` files
are synchronized copies, and the C# bindings in
`Assets/Scripts/PresentationRuntime/Generated/` are generated directly from
the source of truth with the repository's pinned `protoc` version.

From the repository root, check for drift or regenerate after changing a
contract:

```sh
nix run .#unity-proto -- check
nix run .#unity-proto
```

Do not edit the copied `.proto` files or generated C# files directly. Update
the source contract and run the generation task instead.

## Contract test fixtures

EditMode tests decode protobuf JSON through `PresentationContractJsonFixtureLoader`
under `Assets/Tests/EditMode/Editor/Support/`. Unknown fields are rejected. These
fixtures are test data; runtime presentation loading uses the Control Plane Delivery
API and the authenticated Realtime connection.
