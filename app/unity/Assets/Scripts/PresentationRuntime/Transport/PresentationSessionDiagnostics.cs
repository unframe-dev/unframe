using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationSessionDiagnostics
    {
        private sealed class Recording
        {
            internal readonly object Gate = new object();
            internal readonly Queue<JObject> Events = new Queue<JObject>(512);
            internal readonly string Id = Guid.NewGuid().ToString("D");
            internal readonly Func<DateTimeOffset> Now;
            internal readonly Func<double> Elapsed;
            internal readonly string Started;
            internal long NextIndex, Dropped;
            internal double LastStateAt = double.NegativeInfinity;
            internal double LastTrackingAt = double.NegativeInfinity;
            internal Recording(Func<DateTimeOffset> now, Func<double> elapsed)
            {
                var timer = Stopwatch.StartNew();
                Now = now ?? (() => DateTimeOffset.UtcNow);
                Elapsed = elapsed ?? (() => timer.Elapsed.TotalMilliseconds);
                Started = Utc(Now());
            }
        }

        private static readonly HashSet<string> Names = new HashSet<string>(StringComparer.Ordinal)
        {
            "session.create", "session.join", "http.request", "http.response", "delivery.received", "bootstrap.received",
            "assets.ready", "control.sent", "control.received", "control.outcome", "state.sample", "tracking.sample", "connection.stage",
            "connection.retry", "connection.closed", "log.export"
        };
        private readonly Recording recording;
        private readonly string sessionId, runtimeId;
        private readonly ulong? assignmentEpoch, publicationEpoch;

        public PresentationSessionDiagnostics(Func<DateTimeOffset> now = null, Func<double> elapsedMs = null)
        { recording = new Recording(now, elapsedMs); }
        private PresentationSessionDiagnostics(Recording recording, string sessionId, string runtimeId, ulong? assignment, ulong? publication)
        { this.recording = recording; this.sessionId = sessionId; this.runtimeId = runtimeId; assignmentEpoch = assignment; publicationEpoch = publication; }
        public PresentationSessionDiagnostics ForSession(string id) => new PresentationSessionDiagnostics(recording, SafeId(id), null, null, null);
        public PresentationSessionDiagnostics ForRuntime(string id, ulong assignment, ulong publication) => new PresentationSessionDiagnostics(recording, sessionId, SafeId(id), assignment, publication);

        public void Record(string eventName, string stage = null, string code = null, string direction = null, string kind = null,
            ulong? reliableSequence = null, ulong? stateSequence = null, double? runtimeTimeMs = null, string groupId = null, string stepId = null, int? count = null, string commandId = null)
        {
            if (!Names.Contains(eventName)) return;
            lock (recording.Gate)
            {
                var item = new JObject
                {
                    ["index"] = recording.NextIndex++,
                    ["atUtc"] = Utc(recording.Now()),
                    ["elapsedMs"] = Math.Max(0, recording.Elapsed()),
                    ["event"] = eventName
                };
                Add(item, "sessionId", sessionId); Add(item, "runtimeId", runtimeId);
                AddSequence(item, "assignmentEpoch", assignmentEpoch); AddSequence(item, "publicationEpoch", publicationEpoch);
                Add(item, "stage", SafeWord(stage)); Add(item, "code", SafeWord(code));
                if (direction == "send" || direction == "receive") item["direction"] = direction;
                Add(item, "kind", SafeWord(kind));
                AddSequence(item, "reliableSequence", reliableSequence); AddSequence(item, "stateSequence", stateSequence);
                if (runtimeTimeMs.HasValue && !double.IsNaN(runtimeTimeMs.Value) && !double.IsInfinity(runtimeTimeMs.Value) && runtimeTimeMs.Value >= 0)
                    item["runtimeTimeMs"] = runtimeTimeMs.Value;
                if (commandId != null && Regex.IsMatch(commandId, @"\A[A-Za-z0-9:_-]{1,128}\z")) item["commandId"] = commandId;
                Add(item, "groupId", SafeId(groupId)); Add(item, "stepId", SafeId(stepId));
                if (count.HasValue && count.Value >= 0) item["count"] = count.Value;
                if (recording.Events.Count == 512) { recording.Events.Dequeue(); recording.Dropped++; }
                recording.Events.Enqueue(item);
            }
        }

        public void SampleState(ulong reliable, ulong sequence, double runtimeTime, string group, string step)
        {
            lock (recording.Gate)
            {
                double now = recording.Elapsed();
                if (now - recording.LastStateAt < 1000) return;
                recording.LastStateAt = now;
                Record("state.sample", direction: "receive", reliableSequence: reliable, stateSequence: sequence, runtimeTimeMs: runtimeTime, groupId: group, stepId: step);
            }
        }
        public void SampleTracking(ulong sequence)
        {
            lock (recording.Gate)
            {
                double now = recording.Elapsed();
                if (now - recording.LastTrackingAt < 1000) return;
                recording.LastTrackingAt = now;
                Record("tracking.sample", direction: "send", stateSequence: sequence);
            }
        }
        public string ExportJson()
        {
            lock (recording.Gate)
                return new JObject
                {
                    ["schemaVersion"] = 1,
                    ["mode"] = "unframe-session-diagnostic",
                    ["client"] = "mr",
                    ["recordingId"] = recording.Id,
                    ["startedAtUtc"] = recording.Started,
                    ["exportedAtUtc"] = Utc(recording.Now()),
                    ["droppedEvents"] = recording.Dropped,
                    ["events"] = new JArray(recording.Events)
                }.ToString(Formatting.Indented);
        }
        public string ExportToDirectory(string directory)
        {
            Directory.CreateDirectory(directory);
            Record("log.export");
            string path = Path.Combine(directory, "unframe-session-diagnostic-mr-" + recording.Id.Substring(0, 8) + "-" + recording.Now().UtcDateTime.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture) + ".json");
            File.WriteAllText(path, ExportJson(), new UTF8Encoding(false));
            return path;
        }
        private static string Utc(DateTimeOffset value) => value.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);
        private static string SafeId(string value) => value != null && Regex.IsMatch(value, @"\A[A-Za-z0-9_-]{1,128}\z") ? value : null;
        private static string SafeWord(string value) => value != null && Regex.IsMatch(value, @"\A[A-Za-z][A-Za-z0-9_.-]{0,63}\z") ? value : null;
        private static void Add(JObject item, string key, string value) { if (value != null) item[key] = value; }
        private static void AddSequence(JObject item, string key, ulong? value) { if (value.HasValue) item[key] = value.Value.ToString(CultureInfo.InvariantCulture); }
    }
}
