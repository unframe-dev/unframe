using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Cysharp.Net.Http;
using Grpc.Core;
using NUnit.Framework;
using UnityEngine;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationRealtimeConnectionEditModeTests
{
    private sealed class TrackingWriter : IClientStreamWriter<StateClientItem>
    {
        public WriteOptions WriteOptions { get; set; }
        public readonly List<StateClientItem> Items = new List<StateClientItem>();
        public TaskCompletionSource<bool> FirstWriteRelease;
        public Task WriteAsync(StateClientItem item)
        {
            Items.Add(item.Clone());
            return Items.Count == 1 && FirstWriteRelease != null ? FirstWriteRelease.Task : Task.CompletedTask;
        }
        public Task CompleteAsync() { return Task.CompletedTask; }
    }

    private sealed class ControlWriter : IClientStreamWriter<ControlClientItem>
    {
        public WriteOptions WriteOptions { get; set; }
        public readonly List<ControlClientItem> Items = new List<ControlClientItem>();
        public TaskCompletionSource<bool> FirstWriteRelease;
        public Task WriteAsync(ControlClientItem item)
        {
            Items.Add(item.Clone());
            return Items.Count == 1 && FirstWriteRelease != null ? FirstWriteRelease.Task : Task.CompletedTask;
        }
        public Task CompleteAsync() { return Task.CompletedTask; }
    }

    private sealed class ConnectedStateReader : IAsyncStreamReader<StateServerItem>
    {
        private bool connected;
        public StateServerItem Current { get; private set; }
        public async Task<bool> MoveNext(CancellationToken token)
        {
            if (!connected)
            {
                connected = true;
                Current = new StateServerItem { Connected = new StateConnected { ConnectionId = "ready-test" } };
                return true;
            }
            await Task.Delay(Timeout.Infinite, token);
            return false;
        }
    }

    [Test]
    public async Task SendingStateReadyDoesNotPermitInputOrTrackingBeforeFirstKeyframe()
    {
        var store = new PresentationRuntimeDataStore();
        var delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var catalog = delivery.ProjectionProfile.RuntimeCatalog;
        foreach (var node in catalog.Nodes) node.Owner = new Unframe.Presentation.ResourceOwner { Presentation = new Unframe.Presentation.PresentationResourceOwner() };
        foreach (var surface in catalog.Surfaces) surface.Owner = new Unframe.Presentation.ResourceOwner { Presentation = new Unframe.Presentation.PresentationResourceOwner() };
        foreach (var variable in catalog.Variables)
        {
            variable.Owner = new Unframe.Presentation.ResourceOwner { Presentation = new Unframe.Presentation.PresentationResourceOwner() };
            variable.Type = Unframe.Presentation.ScalarType.String;
        }
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        foreach (var variable in catalog.Variables)
            snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Variables.Add(new Unframe.Realtime.VariableState { VariableId = variable.VariableId, Value = new Unframe.Presentation.ScalarValue { StringValue = "value" } });
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryValidateRuntimeOwnership(out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        using (var cancellation = new CancellationTokenSource())
        {
            LoadTrackingTextures(store, textures);
            var tracking = new TrackingWriter();
            var commands = new ControlWriter();
            var stateCall = new AsyncDuplexStreamingCall<StateClientItem, StateServerItem>(tracking, new ConnectedStateReader(), Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
            var controlCall = new AsyncDuplexStreamingCall<ControlClientItem, ControlServerItem>(commands, null, Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
            BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
            typeof(PresentationRealtimeConnection).GetField("state", flags).SetValue(connection, stateCall);
            typeof(PresentationRealtimeConnection).GetField("control", flags).SetValue(connection, controlCall);
            typeof(PresentationRealtimeConnection).GetField("connectionId", flags).SetValue(connection, "ready-test");
            Task run = (Task)typeof(PresentationRealtimeConnection).GetMethod("RunStateAsync", flags).Invoke(connection, new object[] { cancellation.Token });
            try
            {
                Assert.That(commands.Items.Count, Is.EqualTo(1));
                Assert.That(commands.Items[0].ItemCase, Is.EqualTo(ControlClientItem.ItemOneofCase.StateReady));
                Assert.That(connection.SessionReady, Is.False, "A local StateReady write is not server acknowledgement.");
                Assert.Throws<InvalidOperationException>(() => connection.SendAsync(new ControlClientItem { LogicalInput = new LogicalInputCommand { ClientEventId = "event:input", LogicalEventName = "next" } }, CancellationToken.None));
                Assert.Throws<InvalidOperationException>(() => connection.SendTrackingAsync(TrackingInput(), CancellationToken.None));
                Assert.That(tracking.Items, Is.Empty);
                Assert.That(commands.Items.Count, Is.EqualTo(1));
            }
            finally
            {
                cancellation.Cancel();
                try { await run; } catch (OperationCanceledException) { }
            }
        }
    }

    [Test]
    public async Task TrackingWritesAllocateConnectionSequencesAndKeepCallerDataUnchanged()
    {
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(PresentationTextureResidencyEditModeTests.BakedDelivery(), out string error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            LoadTrackingTextures(store, textures);
            var writer = new TrackingWriter();
            PrepareTrackingState(connection, writer);
            TrackingFrame input = TrackingInput();
            input.FrameSequence = 99;
            await SendTracking(connection, input);
            await SendTracking(connection, input);
            Assert.That(writer.Items.Count, Is.EqualTo(2));
            Assert.That(writer.Items[0].TrackingFrame.FrameSequence, Is.EqualTo(1));
            Assert.That(writer.Items[1].TrackingFrame.FrameSequence, Is.EqualTo(2));
            Assert.That(input.FrameSequence, Is.EqualTo(99));
            Assert.That(writer.Items[0].TrackingFrame.Samples[0], Is.EqualTo(input.Samples[0]));
            Assert.That(writer.Items[0].TrackingFrame.PresentationFromQuestLocal, Is.EqualTo(input.PresentationFromQuestLocal));
        }
    }

    [TestCase("serialize")]
    [TestCase("cancel")]
    [TestCase("replace")]
    [TestCase("readiness")]
    public async Task QueuedTrackingPreservesStreamAndCancellationBoundaries(string mode)
    {
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(PresentationTextureResidencyEditModeTests.BakedDelivery(), out string error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        using (var cancellation = new CancellationTokenSource())
        {
            LoadTrackingTextures(store, textures);
            var writer = new TrackingWriter { FirstWriteRelease = new TaskCompletionSource<bool>() };
            PrepareTrackingState(connection, writer);
            Task first = connection.SendTrackingAsync(TrackingInput(), CancellationToken.None);
            TrackingFrame input = TrackingInput();
            Task queued = connection.SendTrackingAsync(input, cancellation.Token);
            input.Samples[0].QuestLocalPose.Position.X = 77;
            Assert.That(writer.Items.Count, Is.EqualTo(1));
            Assert.That(queued.IsCompleted, Is.False);
            if (mode == "cancel") cancellation.Cancel();
            if (mode == "replace") PrepareTrackingState(connection, new TrackingWriter());
            if (mode == "readiness") typeof(PresentationRealtimeConnection).GetMethod("BeginStateStream", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(connection, null);
            writer.FirstWriteRelease.SetResult(true);
            await first;
            if (mode != "serialize")
            {
                Exception failure = null;
                try { await queued; }
                catch (Exception exception) { failure = exception; }
                if (mode == "cancel") Assert.That(failure, Is.InstanceOf<OperationCanceledException>());
                else Assert.That(failure, Is.InstanceOf<InvalidOperationException>());
            }
            else
            {
                await queued;
                Assert.That(writer.Items[1].TrackingFrame.FrameSequence, Is.EqualTo(2));
                Assert.That(writer.Items[1].TrackingFrame.Samples[0].QuestLocalPose.Position.X, Is.Zero);
            }
            Assert.That(writer.Items.Count, Is.EqualTo(mode == "serialize" ? 2 : 1));
        }
    }

    [TestCase("readiness")]
    [TestCase("replace")]
    [TestCase("cancel")]
    public async Task QueuedInputRechecksReadinessAndControlStreamBeforeWriting(string mode)
    {
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(PresentationTextureResidencyEditModeTests.BakedDelivery(), out string error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        using (var cancellation = new CancellationTokenSource())
        {
            LoadTrackingTextures(store, textures);
            PrepareTrackingState(connection, new TrackingWriter());
            var writer = new ControlWriter { FirstWriteRelease = new TaskCompletionSource<bool>() };
            var call = new AsyncDuplexStreamingCall<ControlClientItem, ControlServerItem>(writer, null, Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
            BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
            typeof(PresentationRealtimeConnection).GetField("control", flags).SetValue(connection, call);
            var input = new ControlClientItem { LogicalInput = new LogicalInputCommand { ClientEventId = "event:input", LogicalEventName = "next" } };
            Task first = connection.SendAsync(input, CancellationToken.None);
            Task queued = connection.SendAsync(input, cancellation.Token);
            Assert.That(writer.Items.Count, Is.EqualTo(1));
            Assert.That(queued.IsCompleted, Is.False);
            if (mode == "readiness") typeof(PresentationRealtimeConnection).GetMethod("BeginStateStream", flags).Invoke(connection, null);
            if (mode == "replace") typeof(PresentationRealtimeConnection).GetField("control", flags).SetValue(connection, null);
            if (mode == "cancel") cancellation.Cancel();
            writer.FirstWriteRelease.SetResult(true);
            await first;
            Exception failure = null;
            try { await queued; } catch (Exception exception) { failure = exception; }
            if (mode == "cancel") Assert.That(failure, Is.InstanceOf<OperationCanceledException>());
            else Assert.That(failure, Is.InstanceOf<InvalidOperationException>());
            Assert.That(writer.Items.Count, Is.EqualTo(1));
        }
    }

    [TestCase("calibration")]
    [TestCase("duplicate")]
    [TestCase("non-finite")]
    [TestCase("quaternion")]
    [TestCase("target")]
    [TestCase("limit")]
    [TestCase("viewer")]
    [TestCase("not-ready")]
    public void InvalidOrUnauthorizedTrackingNeverWrites(string invalid)
    {
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(PresentationTextureResidencyEditModeTests.BakedDelivery(), out string error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            LoadTrackingTextures(store, textures);
            var writer = new TrackingWriter();
            PrepareTrackingState(connection, writer);
            TrackingFrame input = TrackingInput();
            if (invalid == "calibration") input.PresentationFromQuestLocal = null;
            if (invalid == "duplicate") input.Samples.Add(input.Samples[0].Clone());
            if (invalid == "non-finite") input.Samples[0].QuestLocalPose.Position.X = double.NaN;
            if (invalid == "quaternion") input.PresentationFromQuestLocal.Rotation.W = 0.5;
            if (invalid == "target") input.Samples[0].Target = (TrackedTarget)99;
            if (invalid == "limit") for (int i = 0; i < 4; i++) input.Samples.Add(input.Samples[0].Clone());
            if (invalid == "viewer") store.Delivery.ProjectionProfile.Key.Role = Unframe.Presentation.SessionRole.Viewer;
            if (invalid == "not-ready") typeof(PresentationRealtimeConnection).GetProperty("SessionReady").SetValue(connection, false);
            Assert.ThrowsAsync<InvalidOperationException>(async () => await SendTracking(connection, input));
            Assert.That(writer.Items, Is.Empty);
        }
    }

    private static TrackingFrame TrackingInput()
    {
        var pose = new Unframe.Presentation.Pose { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } };
        var frame = new TrackingFrame { CapturedAtClientMonotonicMs = 123, PresentationFromQuestLocal = pose.Clone() };
        frame.Samples.Add(new TrackedPoseSample { Target = TrackedTarget.Body, QuestLocalPose = pose, PositionAvailable = true, RotationAvailable = true });
        return frame;
    }

    private static void LoadTrackingTextures(PresentationRuntimeDataStore store, PresentationTextureResidency textures)
    {
        byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
        foreach (var binding in store.Delivery.Residency.Textures.Textures)
        {
            Assert.That(store.TryGetAsset(binding.AssetId, out var access), Is.True);
            Assert.That(textures.TryLoad(binding, access, png, out string error), Is.True, error);
        }
    }

    private static void PrepareTrackingState(PresentationRealtimeConnection connection, TrackingWriter writer)
    {
        var state = new AsyncDuplexStreamingCall<StateClientItem, StateServerItem>(writer, null, Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
        typeof(PresentationRealtimeConnection).GetField("state", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(connection, state);
        typeof(PresentationRealtimeConnection).GetProperty("SessionReady").SetValue(connection, true);
    }

    private static Task SendTracking(PresentationRealtimeConnection connection, TrackingFrame frame)
    {
        MethodInfo method = typeof(PresentationRealtimeConnection).GetMethod("SendTrackingAsync");
        Assert.That(method, Is.Not.Null, "Tracking must use the established State stream.");
        try { return (Task)method.Invoke(connection, new object[] { frame, CancellationToken.None }); }
        catch (TargetInvocationException exception) when (exception.InnerException != null) { throw exception.InnerException; }
    }

    [TestCase(StatusCode.FailedPrecondition, "diagnostic text", 1, true)]
    [TestCase(StatusCode.FailedPrecondition, "runtime_snapshot_required", 0, false)]
    [TestCase(StatusCode.FailedPrecondition, "diagnostic text", 2, false)]
    [TestCase(StatusCode.PermissionDenied, "diagnostic text", 1, false)]
    public void PrivateFaultRetryUsesSingleReasonTrailerAndDropsResume(StatusCode status, string detail, int reasonCount, bool expected)
    {
        using (PresentationTextureResidency textures = new PresentationTextureResidency())
        using (PresentationRealtimeConnection connection = new PresentationRealtimeConnection(new PresentationRuntimeDataStore(), textures))
        {
            Type type = typeof(PresentationRealtimeConnection);
            BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
            type.GetField("connectionId", flags).SetValue(connection, "old-control");
            type.GetField("hasSnapshot", flags).SetValue(connection, true);
            type.GetField("replayMarkerPending", flags).SetValue(connection, true);
            Metadata trailers = new Metadata();
            for (int i = 0; i < reasonCount; i++) trailers.Add("unframe-reason", "runtime_snapshot_required");
            MethodInfo prepare = type.GetMethod("TryPrepareSnapshotRetry", flags);
            Assert.That(prepare, Is.Not.Null, "Private faults must enter fresh Snapshot recovery.");
            bool retry = (bool)prepare.Invoke(connection, new object[] { new RpcException(new Status(status, detail), trailers) });
            Assert.That(retry, Is.EqualTo(expected));
            Assert.That(type.GetField("connectionId", flags).GetValue(connection), Is.EqualTo(expected ? null : "old-control"));
            Assert.That(type.GetField("hasSnapshot", flags).GetValue(connection), Is.EqualTo(!expected));
            Assert.That(type.GetField("replayMarkerPending", flags).GetValue(connection), Is.EqualTo(!expected));
        }
    }

    [Test]
    public void InputRequiresResidentAssetsAndBothRealtimeConnections()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(PresentationTextureResidencyEditModeTests.BakedDelivery(), out string error), Is.True, error);
        using (PresentationTextureResidency textures = new PresentationTextureResidency())
        using (PresentationRealtimeConnection connection = new PresentationRealtimeConnection(store, textures))
        {
            Assert.That(connection.SessionReady, Is.False);
            RpcException exception = Assert.Throws<RpcException>(() => connection.SendAsync(new ControlClientItem { LogicalInput = new LogicalInputCommand { ClientEventId = "event:input", LogicalEventName = "next" } }, CancellationToken.None));
            Assert.That(exception.StatusCode, Is.EqualTo(StatusCode.FailedPrecondition));
            Assert.That(exception.Status.Detail, Is.EqualTo("asset_residency_lost"));
        }
    }

    [Test]
    public async Task NativeHttp2TransportLoadsAndReportsConnectionFailure()
    {
        TcpListener listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        int port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        using (YetAnotherHttpHandler handler = new YetAnotherHttpHandler { Http2Only = true })
        using (HttpClient client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(3) })
        {
            try
            {
                await client.GetAsync("http://127.0.0.1:" + port);
                Assert.Fail("The closed listener must reject the connection.");
            }
            catch (HttpRequestException) { }
        }
    }
}
