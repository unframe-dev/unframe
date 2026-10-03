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

## Local fixtures

`PresentationContractJsonFixtureLoader` accepts protobuf JSON directly. A local
Delivery fixture is a `DeliveryManifest` JSON object using the protobuf JSON
mapping: lower-camel field names, named enum values, and quoted `uint64` values.
Unknown fields are rejected. Assign a `.json` TextAsset to
`LocalPresentationFixtureSource` to load a fixture without a network source.
