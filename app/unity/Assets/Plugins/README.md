# Managed plugins

`Google.Protobuf.dll` is version 3.34.1. The v2 network consumer uses
Grpc.Net.Client / Grpc.Core.Api 2.76.0 and the native HTTP/2 handler installed by
Unity Package Manager at the commit pinned in `Packages/manifest.json`.

`runtime-dependencies.json` records each managed runtime dependency's NuGet
version, target framework, package checksum, DLL checksum and license checksum. Unsafe 6.0.0 is
shared by Protobuf and the transport. Licenses are included beside the DLLs.
Verify the checked-in assemblies or reproduce them from the pinned NuGet packages:

```sh
python3 app/unity/scripts/sync-runtime-dependencies.py check
python3 app/unity/scripts/sync-runtime-dependencies.py generate
```

The HTTP/2 handler supports Android arm64 and provides a Linux x64 build. Editor
transport tests do not establish Quest texture residency or Android native
transport performance; those require device validation.
