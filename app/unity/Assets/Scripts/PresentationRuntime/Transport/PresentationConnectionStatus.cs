using System;
using System.IO;
using System.Net;
using System.Net.Http;
using Google.Protobuf;
using Grpc.Core;

namespace Unframe.Unity.PresentationRuntime
{
    public enum PresentationConnectionStage
    {
        NotConfigured,
        Connecting,
        LoadingAssets,
        Synchronizing,
        Ready,
        Stopped,
        Failed,
    }

    public sealed class PresentationConnectionException : Exception
    {
        public string ErrorCode { get; }
        public PresentationConnectionException(string errorCode) : base(errorCode) { ErrorCode = errorCode; }
    }

    public static class PresentationConnectionErrors
    {
        public static bool CanRetryRealtimeTransport(RpcException exception)
        {
            if (exception.StatusCode == StatusCode.Unavailable) return true;
            if (exception.StatusCode != StatusCode.Internal) return false;
            for (Exception cause = exception.Status.DebugException ?? exception.InnerException; cause != null; cause = cause.InnerException)
                if (cause is InvalidProtocolBufferException || cause is InvalidDataException) return false;
            for (Exception cause = exception.Status.DebugException ?? exception.InnerException; cause != null; cause = cause.InnerException)
                if (cause is IOException || cause is HttpRequestException) return true;
            return false;
        }

        public static bool CanRetryControlPlane(Exception exception)
        {
            if (exception is HttpRequestException || exception is System.Threading.Tasks.TaskCanceledException) return true;
            return exception is PresentationConnectionException failure
                && (failure.ErrorCode == "runtime-unavailable" || failure.ErrorCode == "service-busy" || failure.ErrorCode == "service-unavailable");
        }

        public static string FromHttpStatus(HttpStatusCode status)
        {
            switch (status)
            {
                case HttpStatusCode.Unauthorized: return "authentication-required";
                case HttpStatusCode.Forbidden: return "session-access-denied";
                case HttpStatusCode.NotFound: return "session-not-found";
                case HttpStatusCode.Conflict: return "session-not-available";
                case HttpStatusCode.TooManyRequests: return "service-busy";
                default: return (int)status >= 500 ? "service-unavailable" : "request-rejected";
            }
        }

        public static string FromException(Exception exception)
        {
            if (exception is PresentationConnectionException known) return known.ErrorCode;
            if (exception is RpcException rpc)
            {
                switch (rpc.StatusCode)
                {
                    case StatusCode.Unauthenticated: return "authentication-required";
                    case StatusCode.PermissionDenied: return "session-access-denied";
                    case StatusCode.Unavailable: return "network-unavailable";
                    case StatusCode.DeadlineExceeded: return "connection-timeout";
                    default: return "realtime-connection-failed";
                }
            }
            if (exception is HttpRequestException) return "network-unavailable";
            if (exception is OperationCanceledException) return "connection-timeout";
            if (exception is PresentationDeliveryReloadRequiredException) return "delivery-reload-required";
            return "presentation-connection-failed";
        }
    }
}
