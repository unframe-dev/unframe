using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationSessionDiagnosticsTests
{
    [Test]
    public void RingKeepsOnlyLatest512EventsWithMonotonicIndexes()
    {
        var log = new PresentationSessionDiagnostics();
        for (int i = 0; i < 520; i++) log.Record("connection.stage", stage: "Connecting");
        JObject json = JObject.Parse(log.ExportJson());
        Assert.That((int)json["schemaVersion"], Is.EqualTo(1));
        Assert.That((string)json["mode"], Is.EqualTo("unframe-session-diagnostic"));
        Assert.That((string)json["client"], Is.EqualTo("mr"));
        Assert.That(Guid.TryParse((string)json["recordingId"], out _), Is.True);
        Assert.That((int)json["droppedEvents"], Is.EqualTo(8));
        Assert.That(json["events"].Count(), Is.EqualTo(512));
        Assert.That((long)json["events"][0]["index"], Is.EqualTo(8));
        Assert.That((long)json["events"][511]["index"], Is.EqualTo(519));
    }

    [Test]
    public void OldScopesKeepTheirOwnSessionAndRuntimeAfterReconfiguration()
    {
        var log = new PresentationSessionDiagnostics();
        var old = log.ForSession("session-a").ForRuntime("runtime-a", ulong.MaxValue, ulong.MaxValue);
        var current = log.ForSession("session-b").ForRuntime("runtime-b", 2, 3);
        current.Record("connection.stage", stage: "Ready");
        old.Record("connection.closed", code: "cancelled", commandId: "7:11111111-1111-1111-1111-111111111111");
        JToken events = JObject.Parse(log.ExportJson())["events"];
        Assert.That((string)events[0]["sessionId"], Is.EqualTo("session-b"));
        Assert.That((string)events[1]["sessionId"], Is.EqualTo("session-a"));
        Assert.That((string)events[1]["runtimeId"], Is.EqualTo("runtime-a"));
        Assert.That((string)events[1]["commandId"], Is.EqualTo("7:11111111-1111-1111-1111-111111111111"));
        Assert.That((string)events[1]["assignmentEpoch"], Is.EqualTo("18446744073709551615"));
        Assert.That((string)events[1]["publicationEpoch"], Is.EqualTo("18446744073709551615"));
    }

    [Test]
    public void UnknownEventsAndUnsafeValuesNeverEnterExport()
    {
        var log = new PresentationSessionDiagnostics();
        log.Record("https://secret.example/?token=secret");
        log.ForSession("https://secret.example").Record("connection.stage", stage: "Bearer secret", code: "token=secret", kind: new string('a', 200));
        string exported = log.ExportJson();
        Assert.That(exported, Does.Not.Contain("secret"));
        var json = JObject.Parse(exported);
        Assert.That(json["events"].Count(), Is.EqualTo(1));
        string[] allowed = { "index", "atUtc", "elapsedMs", "event", "sessionId", "runtimeId", "assignmentEpoch", "publicationEpoch", "stage", "code", "direction", "kind", "reliableSequence", "stateSequence", "runtimeTimeMs", "groupId", "stepId", "count", "commandId" };
        Assert.That(((JObject)json["events"][0]).Properties().All(p => allowed.Contains(p.Name)), Is.True);
    }

    [Test]
    public void StateSamplesAreLimitedToOnePerSecondAndSequencesRemainStrings()
    {
        double elapsed = 0;
        var log = new PresentationSessionDiagnostics(() => DateTimeOffset.Parse("2026-10-28T00:00:00Z"), () => elapsed);
        log.SampleState(ulong.MaxValue, ulong.MaxValue, 100, "group", "step");
        elapsed = 999;
        log.SampleState(2, 2, 200, "group", "step");
        elapsed = 1000;
        log.SampleState(3, 3, 300, "group", "step");
        JToken events = JObject.Parse(log.ExportJson())["events"];
        Assert.That(events.Count(), Is.EqualTo(2));
        Assert.That((string)events[0]["reliableSequence"], Is.EqualTo("18446744073709551615"));
        Assert.That((string)events[0]["stateSequence"], Is.EqualTo("18446744073709551615"));
        Assert.That((double)events[1]["elapsedMs"], Is.EqualTo(1000));
    }
    [Test]
    public void FileExportPreservesCommandCorrelationAndDoesNotOverwriteEarlierEvidence()
    {
        string directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "unframe-session-log-" + Guid.NewGuid().ToString("N"));
        try
        {
            var log = new PresentationSessionDiagnostics().ForSession("room").ForRuntime("runtime", 1, 2);
            string command = "1:" + Guid.NewGuid().ToString("D");
            log.Record("control.sent", commandId: command, kind: "Resume", direction: "send");
            log.Record("control.outcome", commandId: command, kind: "Accepted", direction: "receive");
            string first = log.ExportToDirectory(directory);
            string second = log.ExportToDirectory(directory);
            Assert.That(first, Is.Not.EqualTo(second));
            Assert.That(System.IO.File.Exists(first), Is.True);
            var json = JObject.Parse(System.IO.File.ReadAllText(first));
            Assert.That((string)json["events"][0]["commandId"], Is.EqualTo(command));
            Assert.That((string)json["events"][1]["commandId"], Is.EqualTo(command));
            Assert.That((string)json["events"][2]["event"], Is.EqualTo("log.export"));
        }
        finally { if (System.IO.Directory.Exists(directory)) System.IO.Directory.Delete(directory, true); }
    }

}
