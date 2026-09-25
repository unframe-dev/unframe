# Presentation Runtime v2 protobuf input

These files are copied unchanged from PR #93's `packages/contracts/proto/` tree.
`Assets/Scripts/PresentationRuntime/Generated/` is generated from them with `protoc 34.1`:

```sh
protoc --proto_path=Assets/Contracts/Proto --csharp_out=Assets/Scripts/PresentationRuntime/Generated \
  unframe/presentation/v2/runtime.proto \
  unframe/delivery/v2/delivery.proto \
  unframe/realtime/v2/realtime.proto
```

Do not edit generated C# files. Update the source contract and regenerate when the contract changes.

## Local fixtures

`PresentationContractJsonFixtureLoader` accepts protobuf JSON directly. A local
Delivery fixture is a `DeliveryManifest` JSON object using the protobuf JSON
mapping: lower-camel field names, named enum values, and quoted `uint64` values.
Unknown fields are rejected. Assign a `.json` TextAsset to
`LocalPresentationFixtureSource` to load a fixture without a network source.
