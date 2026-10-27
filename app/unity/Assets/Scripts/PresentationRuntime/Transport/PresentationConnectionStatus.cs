using System;
using System.Net;
using System.Net.Http;
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
