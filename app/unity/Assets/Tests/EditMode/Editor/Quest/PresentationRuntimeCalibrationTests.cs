using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Grpc.Core;
using NUnit.Framework;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using Object = UnityEngine.Object;

public sealed class PresentationRuntimeCalibrationTests
{
    private sealed class RuntimeCommandWriter : IClientStreamWriter<ControlClientItem>
    {
        public readonly List<ControlClientItem> Items = new List<ControlClientItem>();
        public WriteOptions WriteOptions { get; set; }
        public Task CompleteAsync() => Task.CompletedTask;
        public Task WriteAsync(ControlClientItem item)
        {
            Items.Add(item.Clone());
            return Task.CompletedTask;
        }
    }

    private static PresentationBakedRuntime PreparePausedRuntime(GameObject host, RuntimeCommandWriter writer,
        out PresentationRealtimeConnection connection)
    {
        var runtime = host.AddComponent<PresentationBakedRuntime>();
        runtime.ConfigureCalibration(new PresentationCalibrationState(), host.transform);
        BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
        var store = (PresentationRuntimeDataStore)typeof(PresentationBakedRuntime).GetField("store", flags).GetValue(runtime);
        Assert.That(store.TryReceiveDelivery(PresentationTextureResidencyEditModeTests.BakedDelivery(), out string error), Is.True, error);
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(
            Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Clock.Paused = new Paused { Reason = PauseReason.ExplicitPause };
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin.Version = 7;
        snapshot.ConnectionSnapshot.Fence.PresentationOriginVersion = 7;
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var textures = new PresentationTextureResidency();
        typeof(PresentationBakedRuntime).GetField("textures", flags).SetValue(runtime, textures);
        byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests)
            .GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
        foreach (var binding in store.Delivery.Residency.Textures.Textures)
        {
            Assert.That(store.TryGetAsset(binding.AssetId, out var access), Is.True);
            Assert.That(textures.TryLoad(binding, access, png, out error), Is.True, error);
        }
        connection = new PresentationRealtimeConnection(store, textures);
        var control = new AsyncDuplexStreamingCall<ControlClientItem, ControlServerItem>(writer, null,
            Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
        typeof(PresentationRealtimeConnection).GetField("control", flags).SetValue(connection, control);
        typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(connection, true);
        typeof(PresentationBakedRuntime).GetField("connection", flags).SetValue(runtime, connection);
        typeof(PresentationBakedRuntime).GetProperty("DownloadReady").SetValue(runtime, true);
        return runtime;
    }

    private static void DestroyPreparedRuntime(GameObject host)
    {
        var runtime = host.GetComponent<PresentationBakedRuntime>();
        if (runtime != null)
        {
            BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
            ((PresentationRealtimeConnection)typeof(PresentationBakedRuntime).GetField("connection", flags).GetValue(runtime))?.Dispose();
            ((PresentationTextureResidency)typeof(PresentationBakedRuntime).GetField("textures", flags).GetValue(runtime))?.Dispose();
        }
        Object.DestroyImmediate(host);
    }

    [TestCase(RuntimeControlKind.Resume)]
    [TestCase(RuntimeControlKind.End)]
    public async Task UncalibratedPresenterCanControlPausedRuntimeWithoutPermittingSpatialInput(RuntimeControlKind kind)
    {
        var host = new GameObject("Paused runtime controls");
        try
        {
            var writer = new RuntimeCommandWriter();
            var runtime = PreparePausedRuntime(host, writer, out _);
            Assert.That(runtime.CalibrationReady, Is.False);
            Assert.That(runtime.SessionReady, Is.False);
            Assert.That(runtime.ControlReady && runtime.CanSendRuntimeControl, Is.True);
            Assert.That(runtime.PresentationOriginVersion, Is.GreaterThan(0));
            var command = new ControlClientItem
            {
                RuntimeControl = new RuntimeControlCommand
                { ClientEventId = "event:runtime-control", Kind = kind, PresentationOriginVersion = runtime.PresentationOriginVersion }
            };
            await runtime.SendAsync(command, CancellationToken.None);
            Assert.That(writer.Items.Count, Is.EqualTo(1));
            Assert.That(writer.Items[0].RuntimeControl, Is.EqualTo(command.RuntimeControl));
            Assert.That(runtime.CanSendInput || runtime.CanSendTracking, Is.False);
            Assert.Throws<InvalidOperationException>(() => runtime.SendAsync(new ControlClientItem
            { LogicalInput = new LogicalInputCommand { ClientEventId = "event:logical", LogicalEventName = "next" } }, CancellationToken.None));
            Assert.Throws<InvalidOperationException>(() => runtime.SendAsync(new ControlClientItem
            { SurfaceInteraction = new SurfaceInteractionCommand { ClientEventId = "event:surface", SurfaceId = "surface", InteractionId = "button" } }, CancellationToken.None));
            Assert.Throws<InvalidOperationException>(() => runtime.SendTrackingAsync(new TrackingFrame(), CancellationToken.None));
            Assert.That(writer.Items.Count, Is.EqualTo(1));
        }
        finally { DestroyPreparedRuntime(host); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task UpdatingAValidCalibrationRequestsRecalibrationAndDoesNotLeaveInputSuspended(bool deferred)
    {
        var host = new GameObject("Calibration replacement");
        QuestPresentationEntry entry = null;
        try
        {
            var writer = new RuntimeCommandWriter();
            var runtime = PreparePausedRuntime(host, writer, out var connection);
            entry = host.AddComponent<QuestPresentationEntry>();
            typeof(QuestPresentationEntry).GetField("questTrackingOrigin", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(entry, host.transform);
            var calibration = new PresentationCalibrationState();
            var pose = new Unframe.Presentation.Pose { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } };
            Assert.That(calibration.TrySet(pose, out _), Is.True);
            entry.Configure(new Uri("https://api.example.com/"), "session", async token =>
            {
                await Task.Delay(Timeout.Infinite, token);
                return "unused";
            }, calibration, null);
            var required = new PresenterInputSynchronization
            {
                Phase = InputSynchronizationPhase.Required, Reason = InputSynchronizationReason.Connected,
                SynchronizationRevision = 1, CommandEpoch = 1,
                InputContext = new InputContext { InputEpoch = 1, GroupId = "g", GroupEntryEpoch = 1, StepId = "s", StepEntryEpoch = 1 },
                RecognitionCatalog = new Unframe.Presentation.PresenterRecognitionCatalog()
            };
            Assert.That(connection.InputSynchronization.Receive(required), Is.True);
            connection.InputSynchronization.TryCreateAck(0);
            var ready = required.Clone(); ready.Phase = InputSynchronizationPhase.Ready;
            Assert.That(connection.InputSynchronization.Receive(ready), Is.True);
            if (deferred) typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(connection, false);
            pose.Position.X = 1;
            Assert.That(calibration.TrySet(pose, out _), Is.True);
            if (deferred)
            {
                Assert.That(writer.Items, Is.Empty);
                typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(connection, true);
                typeof(QuestPresentationEntry).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(entry, null);
            }
            Assert.That(writer.Items.Count, Is.EqualTo(1));
            Assert.That(writer.Items[0].RuntimeControl.Kind, Is.EqualTo(RuntimeControlKind.Recalibrate));
            required.SynchronizationRevision++;
            required.Reason = InputSynchronizationReason.Recalibrated;
            Assert.That(connection.InputSynchronization.Receive(required), Is.True);
            Assert.That(connection.InputSynchronization.TryCreateAck(0), Is.Not.Null);
            ready = required.Clone(); ready.Phase = InputSynchronizationPhase.Ready;
            Assert.That(connection.InputSynchronization.Receive(ready), Is.True);
            Assert.That(connection.InputSynchronization.Ready, Is.True);
        }
        finally
        {
            if (entry != null) await entry.StopAsync();
            DestroyPreparedRuntime(host);
        }
    }

    [TestCase("viewer")]
    [TestCase("control-not-ready")]
    public void RuntimeControlsRequirePresenterAndLiveControlConnection(string blocked)
    {
        var host = new GameObject("Blocked runtime controls");
        try
        {
            var writer = new RuntimeCommandWriter();
            var runtime = PreparePausedRuntime(host, writer, out var connection);
            if (blocked == "viewer")
            {
                var store = (PresentationRuntimeDataStore)typeof(PresentationBakedRuntime)
                    .GetField("store", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(runtime);
                store.Delivery.ProjectionProfile.Key.Role = Unframe.Presentation.SessionRole.Viewer;
            }
            else typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(connection, false);
            Assert.That(runtime.CanSendRuntimeControl, Is.False);
            if (blocked == "control-not-ready")
            {
                Assert.That(runtime.ControlReady, Is.False);
                Assert.That(runtime.PresentationOriginVersion, Is.Zero);
            }
            Assert.Throws<InvalidOperationException>(() => runtime.SendAsync(new ControlClientItem
            { RuntimeControl = new RuntimeControlCommand { ClientEventId = "event:resume", Kind = RuntimeControlKind.Resume, PresentationOriginVersion = 1 } }, CancellationToken.None));
            Assert.That(writer.Items, Is.Empty);
        }
        finally { DestroyPreparedRuntime(host); }
    }

    [Test]
    public void RuntimeRootUsesInverseCalibrationAndKeepsRuntimeOriginSeparate()
    {
        var host = new GameObject("Runtime");
        var tracking = new GameObject("Tracking");
        try
        {
            tracking.transform.SetPositionAndRotation(new Vector3(2, 3, 4), Quaternion.Euler(0, 35, 0));
            var marker = new Pose(new Vector3(1, 2, 5), Quaternion.Euler(20, 15, 0));
            Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(marker, tracking.transform, out var pose, out string error), Is.True, error);
            var calibration = new PresentationCalibrationState();
            Assert.That(calibration.TrySet(pose, out error), Is.True, error);
            var runtime = host.AddComponent<PresentationBakedRuntime>();
            runtime.ConfigureCalibration(calibration, tracking.transform);
            runtime.RefreshCalibration();
            Assert.That(runtime.CalibrationReady, Is.True);
            Assert.That(Vector3.Distance(runtime.PresentationSpace.position, marker.position), Is.LessThan(0.00001));
            Assert.That(Quaternion.Angle(runtime.PresentationSpace.rotation, marker.rotation), Is.LessThan(0.01));
            Assert.That(runtime.PresentationSpace.localScale, Is.EqualTo(Vector3.one));
            Assert.That(runtime.PresentationSpace.gameObject.activeSelf, Is.False, "An unconnected runtime must stay hidden.");
            Assert.That(runtime.CanSendInput || runtime.CanSendTracking, Is.False);
            var child = new GameObject("Runtime origin");
            child.transform.SetParent(runtime.PresentationSpace, false);
            child.transform.localPosition = new Vector3(0.4f, 0.5f, 0.6f);
            child.transform.localRotation = Quaternion.Euler(0, 25, 0);
            var node = new GameObject("Node");
            node.transform.SetParent(child.transform, false);
            node.transform.localPosition = new Vector3(0.7f, 0.8f, 0.9f);
            Vector3 expected = marker.position + marker.rotation * (child.transform.localPosition + child.transform.localRotation * node.transform.localPosition);
            runtime.RefreshCalibration();
            runtime.RefreshCalibration();
            Assert.That(Vector3.Distance(node.transform.position, expected), Is.LessThan(0.00001));
            calibration.Invalidate("recentered");
            Assert.That(runtime.CalibrationReady, Is.False);
            Assert.That(runtime.PresentationSpace.gameObject.activeSelf, Is.False);
            Assert.That(calibration.TrySet(pose, out error), Is.True, error);
            Assert.That(runtime.CalibrationReady, Is.True);
            typeof(PresentationBakedRuntime).GetMethod("OnDestroy", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(runtime, null);
            Object.DestroyImmediate(host);
            Assert.That(child == null, Is.True, "Runtime disposal must remove the independent generated space.");
        }
        finally { Object.DestroyImmediate(host); Object.DestroyImmediate(tracking); }
    }

    [Test]
    public void ReplacingCalibrationUnsubscribesTheOldState()
    {
        var host = new GameObject("Runtime");
        var tracking = new GameObject("Tracking");
        try
        {
            var previous = new PresentationCalibrationState();
            var current = new PresentationCalibrationState();
            var pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity);
            Assert.That(previous.TrySet(pose, out _), Is.True);
            Assert.That(current.TrySet(pose, out _), Is.True);
            var runtime = host.AddComponent<PresentationBakedRuntime>();
            runtime.ConfigureCalibration(previous, tracking.transform);
            runtime.ConfigureCalibration(current, tracking.transform);
            tracking.transform.localScale = new Vector3(2, 1, 1);
            previous.Invalidate("old-source-reset");
            Assert.That(current.IsValid, Is.True, "The old source must not invoke Runtime calibration refresh.");
            runtime.RefreshCalibration();
            Assert.That(current.IsValid, Is.False);
        }
        finally { Object.DestroyImmediate(host); Object.DestroyImmediate(tracking); }
    }

    [Test]
    public void InvalidTrackingScaleInvalidatesCalibrationAndStopsInput()
    {
        var host = new GameObject("Runtime");
        var tracking = new GameObject("Tracking");
        try
        {
            var calibration = new PresentationCalibrationState();
            Assert.That(calibration.TrySet(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _), Is.True);
            var runtime = host.AddComponent<PresentationBakedRuntime>();
            runtime.ConfigureCalibration(calibration, tracking.transform);
            tracking.transform.localScale = new Vector3(2, 1, 1);
            runtime.RefreshCalibration();
            Assert.That(calibration.IsValid, Is.False);
            Assert.That(runtime.CalibrationReady, Is.False);
            Assert.That(runtime.CanSendInput || runtime.CanSendTracking, Is.False);
            tracking.transform.localScale = Vector3.one;
            runtime.RefreshCalibration();
            Assert.That(runtime.CalibrationReady, Is.False, "Restoring tracking must not silently recalibrate.");
        }
        finally { Object.DestroyImmediate(host); Object.DestroyImmediate(tracking); }
    }
}
