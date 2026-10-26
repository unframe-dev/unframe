#if UNITY_EDITOR
using System;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime.Editor
{
    public sealed class PresentationSampleConnectionSettings
    {
        [Serializable]
        private sealed class Descriptor
        {
            public int version;
            public string controlPlaneOrigin, sessionId, credential, caFile, expiresAt, presentationId, buildId;
        }

        public Uri Origin { get; private set; }
        public string SessionId { get; private set; }
        public string Credential { get; private set; }
        public string RootCertificates { get; private set; }
        public DateTimeOffset ExpiresAt { get; private set; }
        public string PresentationId { get; private set; }
        public string BuildId { get; private set; }

        public void ClearCredential() => Credential = null;

        public static PresentationSampleConnectionSettings Load(string path, DateTimeOffset now)
        {
            try
            {
                Descriptor value = JsonUtility.FromJson<Descriptor>(ReadBounded(path, 64 * 1024));
                if (value == null || value.version != 1
                    || !Uri.TryCreate(value.controlPlaneOrigin, UriKind.Absolute, out Uri origin)
                    || origin.Scheme != "https" || !origin.IsLoopback || origin.AbsolutePath != "/"
                    || !string.IsNullOrEmpty(origin.UserInfo) || !string.IsNullOrEmpty(origin.Query) || !string.IsNullOrEmpty(origin.Fragment)
                    || string.IsNullOrWhiteSpace(value.sessionId) || value.sessionId.Length > 1024
                    || string.IsNullOrWhiteSpace(value.credential) || value.credential.Length > 32768
                    || value.credential.IndexOfAny(new[] { '\r', '\n' }) >= 0
                    || string.IsNullOrWhiteSpace(value.presentationId) || string.IsNullOrWhiteSpace(value.buildId)
                    || !DateTimeOffset.TryParse(value.expiresAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out DateTimeOffset expiry)
                    || string.IsNullOrWhiteSpace(value.caFile) || !Path.IsPathRooted(value.caFile))
                    throw new InvalidOperationException("sample-connection-invalid");
                if (expiry <= now) throw new InvalidOperationException("sample-connection-expired");
                string certificates = ReadBounded(value.caFile, 256 * 1024);
                if (!certificates.Contains("-----BEGIN CERTIFICATE-----") || !certificates.Contains("-----END CERTIFICATE-----"))
                    throw new InvalidOperationException("sample-connection-invalid");
                return new PresentationSampleConnectionSettings
                {
                    Origin = origin, SessionId = value.sessionId, Credential = value.credential,
                    RootCertificates = certificates, ExpiresAt = expiry, PresentationId = value.presentationId, BuildId = value.buildId,
                };
            }
            catch (InvalidOperationException exception) when (exception.Message == "sample-connection-expired") { throw; }
            catch (Exception) { throw new InvalidOperationException("sample-connection-invalid"); }
        }

        private static string ReadBounded(string path, int maximum)
        {
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (input.Length > maximum) throw new InvalidOperationException("sample-connection-invalid");
                byte[] bytes = new byte[maximum + 1];
                int count = 0, read;
                while ((read = input.Read(bytes, count, bytes.Length - count)) != 0)
                {
                    count += read;
                    if (count > maximum) throw new InvalidOperationException("sample-connection-invalid");
                }
                return new UTF8Encoding(false, true).GetString(bytes, 0, count);
            }
        }
    }
}

#endif
