using System;
using System.IO;
using System.Net.Http;
using System.Reflection;
using Google.Protobuf;
using Grpc.Core;
using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationRealtimeResyncEditModeTests
{
    [TestCase(StatusCode.Unavailable, true)]
    [TestCase(StatusCode.Internal, false)]
    [TestCase(StatusCode.FailedPrecondition, false)]
    [TestCase(StatusCode.PermissionDenied, false)]
    [TestCase(StatusCode.Cancelled, false)]
    public void RemoteStatusDoesNotConvertProtocolOrAuthorizationFailuresIntoTransportRetries(StatusCode code, bool retryable)
    {
        Assert.That(PresentationConnectionErrors.CanRetryRealtimeTransport(new RpcException(new Status(code, "server-result"))), Is.EqualTo(retryable));
    }

    [Test]
    public void ManagedHttp2ReadResetIsATransportRetry()
    {
        var failure = new RpcException(new Status(StatusCode.Internal, "read-reset", new HttpRequestException("body read", new IOException("connection reset"))));
        Assert.That(PresentationConnectionErrors.CanRetryRealtimeTransport(failure), Is.True);
    }

    [Test]
    public void InvalidProtobufIsFatalEvenWhenTheCodecExceptionIsAnIOException()
    {
        var malformed = Assert.Throws<InvalidProtocolBufferException>(() => ControlServerItem.Parser.ParseFrom(new byte[] { 0x0a, 0x05, 0x01 }));
        var failure = new RpcException(new Status(StatusCode.Internal, "invalid-protobuf", malformed));
        Assert.That(PresentationConnectionErrors.CanRetryRealtimeTransport(failure), Is.False);
    }

    [TestCase(ResyncReason.ReplayRangeUnavailable)]
    [TestCase(ResyncReason.PresentationOriginChanged)]
    [TestCase(ResyncReason.SnapshotCatchUpExhausted)]
    public void RecoverableResyncClearsResumeCursorBeforeOpeningANewStream(ResyncReason reason)
    {
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(new PresentationRuntimeDataStore(), textures))
        {
            Set(connection, "connectionId", "old-connection");
            Set(connection, "fence", new RuntimeProjectionFence());
            Set(connection, "hasSnapshot", true);
            var failure = Invoke(connection, reason);
            Assert.That(failure.GetType().Name, Is.EqualTo("SnapshotResyncRequiredException"));
            Assert.That(Get(connection, "connectionId"), Is.Null);
            Assert.That(Get(connection, "fence"), Is.Null);
            Assert.That(Get(connection, "hasSnapshot"), Is.False);
        }
    }

    [TestCase(ResyncReason.ProjectionChanged)]
    [TestCase(ResyncReason.PublicationFenceChanged)]
    public void AssignmentOrPublicationChangeRequiresDeliveryReload(ResyncReason reason)
    {
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(new PresentationRuntimeDataStore(), textures))
        {
            var failure = Invoke(connection, reason);
            Assert.That(failure, Is.TypeOf<PresentationDeliveryReloadRequiredException>());
            Assert.That(((PresentationDeliveryReloadRequiredException)failure).Reason, Is.EqualTo(reason));
        }
    }

    [Test]
    public void UnknownResyncReasonDoesNotBecomeAnAutomaticRetry()
    {
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(new PresentationRuntimeDataStore(), textures))
        {
            var failure = Invoke(connection, ResyncReason.Unspecified);
            Assert.That(failure, Is.TypeOf<RpcException>());
            Assert.That(((RpcException)failure).StatusCode, Is.EqualTo(StatusCode.FailedPrecondition));
        }
    }

    private static Exception Invoke(PresentationRealtimeConnection connection, ResyncReason reason)
    {
        MethodInfo method = typeof(PresentationRealtimeConnection).GetMethod("HandleResync", BindingFlags.NonPublic | BindingFlags.Instance);
        var invocation = Assert.Throws<TargetInvocationException>(() => method.Invoke(connection, new object[] { reason }));
        return invocation.InnerException;
    }

    private static void Set(PresentationRealtimeConnection connection, string name, object value)
    {
        typeof(PresentationRealtimeConnection).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).SetValue(connection, value);
    }

    private static object Get(PresentationRealtimeConnection connection, string name)
    {
        return typeof(PresentationRealtimeConnection).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).GetValue(connection);
    }
}
