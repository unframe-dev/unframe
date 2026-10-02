using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unframe.Delivery.V2;

namespace Unframe.Unity.PresentationRuntime
{
    internal sealed class SessionSelectionRegistry : IDisposable
    {
        internal sealed class Asset
        {
            [JsonProperty("checksum")] public string Checksum { get; set; }
            [JsonProperty("encodedSizeBytes")] public ulong EncodedSizeBytes { get; set; }
            [JsonProperty("mediaType")] public string MediaType { get; set; }

            internal AssetAccessBinding ToBinding() => new AssetAccessBinding
            {
                Checksum = Checksum,
                EncodedSizeBytes = EncodedSizeBytes,
                MediaType = MediaType,
            };
        }

        internal sealed class Selection
        {
            [JsonProperty("sessionId")] public string SessionId { get; set; }
            [JsonProperty("participantId")] public string ParticipantId { get; set; }
            [JsonProperty("presentationId")] public string PresentationId { get; set; }
            [JsonProperty("publicationEpoch")] public ulong PublicationEpoch { get; set; }
            [JsonProperty("publicationManifestHash")] public string PublicationManifestHash { get; set; }
            [JsonProperty("assignmentEpoch")] public ulong AssignmentEpoch { get; set; }
            [JsonProperty("projectionProfileId")] public string ProjectionProfileId { get; set; }
            [JsonProperty("assets")] public List<Asset> Assets { get; set; }

            internal string ConsumerToken => PresentationRuntimeHost.ConsumerToken(SessionId, ParticipantId);
            internal PresentationEncodedAssetCache.SessionSelection ToCacheSelection() =>
                new PresentationEncodedAssetCache.SessionSelection(ConsumerToken, Assets.Select(asset => asset.ToBinding()).ToArray());
        }

        private sealed class State
        {
            [JsonProperty("version")] public int Version { get; set; } = 1;
            [JsonProperty("selections")] public List<Selection> Selections { get; set; } = new List<Selection>();
        }

        private const int MaximumBytes = 8 * 1024 * 1024;
        private readonly string path;
        private readonly FileStream ownerLock;
        private State state;

        internal SessionSelectionRegistry(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("A selection registry path is required.", nameof(path));
            this.path = Path.GetFullPath(path);
            Directory.CreateDirectory(Path.GetDirectoryName(this.path));
            ownerLock = new FileStream(this.path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            try { state = File.Exists(this.path) ? Read() : new State(); }
            catch { ownerLock.Dispose(); throw; }
        }

        internal IReadOnlyList<Selection> Selections => state.Selections;

        internal void Upsert(Selection selection)
        {
            Validate(selection);
            Selection previous = state.Selections.FirstOrDefault(item => item.ConsumerToken == selection.ConsumerToken);
            if (previous != null && (previous.PresentationId != selection.PresentationId
                || previous.PublicationEpoch > selection.PublicationEpoch
                || previous.PublicationEpoch == selection.PublicationEpoch && previous.PublicationManifestHash != selection.PublicationManifestHash
                || previous.AssignmentEpoch > selection.AssignmentEpoch))
                throw new InvalidOperationException("session-selection-registry-stale-delivery");
            State next = new State { Selections = state.Selections.Where(item => item.ConsumerToken != selection.ConsumerToken).ToList() };
            next.Selections.Add(selection);
            Validate(next);
            Persist(next);
            state = next;
        }

        internal void Remove(string sessionId, string participantId)
        {
            State next = new State { Selections = state.Selections.Where(item => item.SessionId != sessionId || item.ParticipantId != participantId).ToList() };
            Persist(next);
            state = next;
        }

        private State Read()
        {
            try
            {
                byte[] bytes;
                using (FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (file.Length > MaximumBytes) throw new InvalidOperationException();
                    bytes = new byte[checked((int)file.Length)];
                    int offset = 0;
                    while (offset < bytes.Length)
                    {
                        int count = file.Read(bytes, offset, bytes.Length - offset);
                        if (count == 0) throw new InvalidOperationException();
                        offset += count;
                    }
                    if (file.ReadByte() != -1 || file.Length != bytes.Length) throw new InvalidOperationException();
                }
                using (StringReader text = new StringReader(new UTF8Encoding(false, true).GetString(bytes)))
                using (JsonTextReader reader = new JsonTextReader(text) { MaxDepth = 32 })
                {
                    JObject parsed = JObject.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
                    if (reader.Read()) throw new InvalidOperationException();
                    RequireFields(parsed, "version", "selections");
                    if (Unsigned(parsed["version"]) != 1 || parsed["selections"].Type != JTokenType.Array) throw new InvalidOperationException();
                    foreach (JToken item in (JArray)parsed["selections"])
                    {
                        JObject selection = RequireObject(item, "sessionId", "participantId", "presentationId",
                            "publicationEpoch", "publicationManifestHash", "assignmentEpoch", "projectionProfileId", "assets");
                        RequireString(selection["sessionId"]);
                        RequireString(selection["participantId"]);
                        RequireString(selection["presentationId"]);
                        Unsigned(selection["publicationEpoch"]);
                        RequireString(selection["publicationManifestHash"]);
                        Unsigned(selection["assignmentEpoch"]);
                        RequireString(selection["projectionProfileId"]);
                        if (selection["assets"].Type != JTokenType.Array) throw new InvalidOperationException();
                        foreach (JToken entry in (JArray)selection["assets"])
                        {
                            JObject asset = RequireObject(entry, "checksum", "encodedSizeBytes", "mediaType");
                            RequireString(asset["checksum"]);
                            Unsigned(asset["encodedSizeBytes"]);
                            RequireString(asset["mediaType"]);
                        }
                    }
                    State loaded = parsed.ToObject<State>();
                    Validate(loaded);
                    return loaded;
                }
            }
            catch (Exception exception) when (exception is IOException || exception is JsonException || exception is InvalidOperationException
                || exception is OverflowException || exception is DecoderFallbackException || exception is ArgumentException)
            { throw new InvalidOperationException("session-selection-registry-invalid", exception); }
        }

        private static JObject RequireObject(JToken token, params string[] fields)
        {
            if (!(token is JObject value)) throw new InvalidOperationException();
            RequireFields(value, fields);
            return value;
        }

        private static void RequireFields(JObject value, params string[] fields)
        {
            if (value.Count != fields.Length || fields.Any(field => value.Property(field) == null)
                || value.Properties().Any(property => !fields.Contains(property.Name))) throw new InvalidOperationException();
        }

        private static void RequireString(JToken token)
        {
            if (token == null || token.Type != JTokenType.String) throw new InvalidOperationException();
        }

        private static ulong Unsigned(JToken token)
        {
            if (token == null || token.Type != JTokenType.Integer
                || !ulong.TryParse(token.ToString(Formatting.None), NumberStyles.None, CultureInfo.InvariantCulture, out ulong value))
                throw new InvalidOperationException();
            return value;
        }

        private static void Validate(State value)
        {
            if (value == null || value.Version != 1 || value.Selections == null) throw new InvalidOperationException("session-selection-registry-invalid");
            HashSet<string> tokens = new HashSet<string>(StringComparer.Ordinal);
            foreach (Selection selection in value.Selections)
            {
                Validate(selection);
                if (!tokens.Add(selection.ConsumerToken)) throw new InvalidOperationException("session-selection-registry-invalid");
            }
        }

        private static void Validate(Selection value)
        {
            if (value == null || !PresentationDeliveryCatalog.IsId(value.SessionId) || !PresentationDeliveryCatalog.IsId(value.ParticipantId)
                || !PresentationDeliveryCatalog.IsId(value.PresentationId) || value.PublicationEpoch == 0
                || !PresentationDeliveryCatalog.IsContentHash(value.PublicationManifestHash) || value.AssignmentEpoch == 0
                || !PresentationDeliveryCatalog.IsId(value.ProjectionProfileId) || value.Assets == null)
                throw new InvalidOperationException("session-selection-registry-invalid");
            Dictionary<string, ulong> checksums = new Dictionary<string, ulong>(StringComparer.Ordinal);
            foreach (Asset asset in value.Assets)
            {
                if (asset == null || !PresentationDeliveryCatalog.IsContentHash(asset.Checksum)
                    || asset.EncodedSizeBytes == 0 || asset.MediaType != "image/png"
                    || checksums.TryGetValue(asset.Checksum, out ulong previous) && previous != asset.EncodedSizeBytes)
                    throw new InvalidOperationException("session-selection-registry-invalid");
                checksums[asset.Checksum] = asset.EncodedSizeBytes;
            }
        }

        private void Persist(State next)
        {
            byte[] bytes = new UTF8Encoding(false, true).GetBytes(JsonConvert.SerializeObject(next));
            if (bytes.Length > MaximumBytes) throw new InvalidOperationException("session-selection-registry-invalid");
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (FileStream file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                {
                    file.Write(bytes, 0, bytes.Length);
                    file.Flush(true);
                }
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        public void Dispose() { ownerLock.Dispose(); }
    }
}
