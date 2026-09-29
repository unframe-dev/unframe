# Managed plugins

`Google.Protobuf.dll` is version 3.34.1 and references
`System.Runtime.CompilerServices.Unsafe, Version=4.0.4.1` when serializing
binary messages. The matching implementation is
`System.Runtime.CompilerServices.Unsafe.dll`, taken from
[`System.Runtime.CompilerServices.Unsafe` 4.5.3](https://www.nuget.org/packages/System.Runtime.CompilerServices.Unsafe/4.5.3)
at `lib/netstandard2.0/System.Runtime.CompilerServices.Unsafe.dll`.
Its package license is included alongside the DLL.

SHA-256 of the included DLL:

```text
bfc8f02a96934786ca5a0514a3b657021c12542e215e94b78fdcc74bfeffe3d3
```
