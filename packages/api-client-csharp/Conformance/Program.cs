using System.Text.Json;
using Google.Protobuf;
using Unframe.Delivery.V2;
using Unframe.Realtime.V2;

if (args.Length != 2) throw new ArgumentException("Pass conformance.json and valid-delivery.json paths");
foreach (var path in args)
{
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var fixtures = document.RootElement.ValueKind == JsonValueKind.Array
        ? document.RootElement.EnumerateArray().ToArray()
        : new[] { document.RootElement };
    foreach (var fixture in fixtures)
    {
        var typeName = fixture.GetProperty("typeName").GetString();
        var expected = Convert.FromHexString(fixture.GetProperty("hex").GetString()!);
        var value = fixture.GetProperty("value").GetRawText();
        switch (typeName)
        {
            case "unframe.delivery.v2.DeliveryManifest":
                {
                    var fromJson = JsonParser.Default.Parse<DeliveryManifest>(value);
                    var fromWire = DeliveryManifest.Parser.ParseFrom(expected);
                    if (!fromJson.Equals(fromWire) ||
                        (Path.GetFileName(path) == "conformance.json" && !fromWire.ToByteArray().SequenceEqual(expected)) ||
                        !DeliveryManifest.Parser.ParseFrom(fromWire.ToByteArray()).Equals(fromWire))
                        throw new Exception("DeliveryManifest JSON/binary conformance failed");
                    if (Path.GetFileName(path) == "valid-delivery.json")
                    {
                        if (fromWire.ProjectionProfile.RenderSurfaces.Count < 2 ||
                            fromWire.ProjectionProfile.SemanticSurfaces.Count == 0 ||
                            fromWire.ProjectionProfile.RuntimeCatalog == null)
                            throw new Exception("Compiled DeliveryManifest semantics are incomplete");
                    }
                    else if (fromWire.Publication.PublicationEpoch != 9007199254740993UL ||
                        fromWire.ProjectionInstance.AssignmentEpoch != 9007199254740995UL ||
                        fromWire.AssetAccess[0].ExpiresAtUnixMs != 9007199254740997UL)
                        throw new Exception("DeliveryManifest 64-bit value changed");
                    var future = DeliveryManifest.Parser.ParseFrom(expected.Concat(new byte[] { 0x98, 0x06, 0x01 }).ToArray());
                    if (!future.ToByteArray().TakeLast(3).SequenceEqual(new byte[] { 0x98, 0x06, 0x01 }))
                        throw new Exception("DeliveryManifest unknown field was lost");
                    break;
                }
            case "unframe.realtime.v2.ControlClientItem":
                {
                    var fromJson = JsonParser.Default.Parse<ControlClientItem>(value);
                    var fromWire = ControlClientItem.Parser.ParseFrom(expected);
                    if (!fromJson.Equals(fromWire) || !fromWire.ToByteArray().SequenceEqual(expected))
                        throw new Exception("ControlClientItem JSON/binary conformance failed");
                    if (fromWire.ItemCase != ControlClientItem.ItemOneofCase.Handshake ||
                        fromWire.Handshake.Resume.AppliedReliableSequence != 9007199254740999UL ||
                        fromWire.Handshake.Resume.Fence.PresentationOriginVersion != 9007199254741001UL)
                        throw new Exception("ControlClientItem oneof/fence changed");
                    break;
                }
            default:
                throw new Exception($"Unexpected fixture type: {typeName}");
        }
    }
}
Console.WriteLine("C# wire conformance passed");
