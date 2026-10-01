using System;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class ArucoDiagnosticFailureTests
{
    private sealed class FailingWriter : StringWriter
    {
        public bool FailWrites;
        public bool FailFlush;
        public int WriteAttempts;
        public int DisposeCalls;
        public override void WriteLine(string value)
        {
            WriteAttempts++;
            if (FailWrites) throw new IOException("Injected diagnostic write failure");
            base.WriteLine(value);
        }
        public override void Flush()
        {
            if (FailFlush) throw new IOException("Injected diagnostic flush failure");
            base.Flush();
        }
        protected override void Dispose(bool disposing)
        {
            DisposeCalls++;
            base.Dispose(disposing);
        }
    }

    private string directory;

    [SetUp]
    public void SetUp() => directory = Path.Combine(Path.GetTempPath(), "unframe-diagnostic-failure-" + Guid.NewGuid().ToString("N"));

    [TearDown]
    public void TearDown()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void ConstructorClosesTheWriterWhenTheFirstRecordFails(bool flushFailure)
    {
        var writer = new FailingWriter { FailWrites = !flushFailure, FailFlush = flushFailure };
        Assert.Throws<IOException>(() => new ArucoTrackingDiagnostics(directory, _ => writer));
        Assert.That(writer.DisposeCalls, Is.EqualTo(1));
    }

    [TestCase(false)]
    [TestCase(true)]
    public void DisposeClosesTheWriterEvenWhenTheFinalRecordFails(bool flushFailure)
    {
        var writer = new FailingWriter();
        var diagnostics = new ArucoTrackingDiagnostics(directory, _ => writer);
        writer.FailWrites = !flushFailure;
        writer.FailFlush = flushFailure;
        Assert.Throws<IOException>(() => diagnostics.Dispose());
        Assert.That(writer.DisposeCalls, Is.EqualTo(1));
        Assert.DoesNotThrow(() => diagnostics.Dispose());
        Assert.Throws<ObjectDisposedException>(() => diagnostics.Record(new ArucoTrackingDiagnosticEvent { eventType = "after_close" }));
    }

    [Test]
    public void SessionStopsAllProducersAfterOneFailureAndSafelyPausesAndDestroys()
    {
        var writer = new FailingWriter();
        var diagnostics = new ArucoTrackingDiagnostics(directory, _ => writer);
        var host = new GameObject("Diagnostic Failure Test");
        host.SetActive(false);
        var session = host.AddComponent<ArucoTrackingDiagnosticSession>();
        session.Initialize(diagnostics);
        host.SetActive(true);
        try
        {
            Assert.That(session.TryRecord(new ArucoTrackingDiagnosticEvent { eventType = "first_producer" }), Is.True);
            writer.FailWrites = true;
            LogAssert.Expect(LogType.Error, new Regex("Diagnostic logging stopped"));
            Assert.That(session.TryRecord(new ArucoTrackingDiagnosticEvent { eventType = "failing_producer" }), Is.False);
            Assert.That(session.LoggingFailed, Is.True);
            int attempts = writer.WriteAttempts;
            Assert.That(session.TryRecord(new ArucoTrackingDiagnosticEvent { eventType = "other_producer" }), Is.False);
            Assert.DoesNotThrow(() => InvokeLifecycle(session, "OnApplicationPause", true));
            Assert.DoesNotThrow(() => InvokeLifecycle(session, "OnApplicationPause", false));
            Assert.That(writer.WriteAttempts, Is.EqualTo(attempts));
            Assert.That(session.Diagnostics.FilePath, Is.EqualTo(diagnostics.FilePath));
        }
        finally
        {
            InvokeLifecycle(session, "OnDestroy");
            UnityEngine.Object.DestroyImmediate(host);
        }
        Assert.That(writer.DisposeCalls, Is.EqualTo(1));
    }

    [Test]
    public void DestroyClosesTheLogEvenWhenSessionEndCannotBeWritten()
    {
        var writer = new FailingWriter();
        var diagnostics = new ArucoTrackingDiagnostics(directory, _ => writer);
        var host = new GameObject("Diagnostic Shutdown Failure Test");
        host.SetActive(false);
        var session = host.AddComponent<ArucoTrackingDiagnosticSession>();
        session.Initialize(diagnostics);
        host.SetActive(true);
        writer.FailWrites = true;
        LogAssert.Expect(LogType.Error, new Regex("Diagnostic logging stopped"));
        try
        {
            Assert.DoesNotThrow(() => InvokeLifecycle(session, "OnDestroy"));
            Assert.That(writer.DisposeCalls, Is.EqualTo(1));
            Assert.That(session.Diagnostics, Is.Null);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); }
    }

    private static void InvokeLifecycle(ArucoTrackingDiagnosticSession session, string method, params object[] arguments)
    {
        typeof(ArucoTrackingDiagnosticSession).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(session, arguments);
    }
}
