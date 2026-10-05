using System;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationRealtimeCertificateEditModeTests
{
    private delegate bool PinVerifier(string expectedHost, string serverName, ReadOnlySpan<byte> certificateDer, DateTimeOffset now, string fingerprint);

    // Public self-signed certificate with an IP SAN; no private key is part of this fixture.
    private const string CertificateDerBase64 =
        "MIIBjjCCATSgAwIBAgIUYYCxZ5Gb70d8+YZpKnM+DUmP/3cwCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTAwMTIxMDA1N1oXDTM2MDkyODIxMDA1N1owFDESMBAGA1UEAwwJMTI3LjAuMC4xMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEK/lKctF1AfgGjZ70omv8Gz1M3ez4pjmZlXrrebX1jBGKy7SKzTe7aHqC6AgNfTkZVs+RKw0e8yeofNgGSUm586NkMGIwHQYDVR0OBBYEFLJJD9An6tJ4qpFkpxdD3nMACoP2MB8GA1UdIwQYMBaAFLJJD9An6tJ4qpFkpxdD3nMACoP2MA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocEfwAAATAKBggqhkjOPQQDAgNIADBFAiEA2gycNugzyufkcVjO+E2AbK//pg+au0EkCKo4E1+3fMICIBzu0u9RtqIphToHEt9YQUQ2AhUaDB24OUWWPWCgb9wD";

    [Test]
    public void AuthenticatedEndpointCanPinAnIpCertificateButRejectsHashHostAndLifetimeMismatch()
    {
        byte[] der = Convert.FromBase64String(CertificateDerBase64);
        using (var certificate = new X509Certificate2(der))
        using (var sha = SHA256.Create())
        {
            string pin = "sha256:" + BitConverter.ToString(sha.ComputeHash(der)).Replace("-", "").ToLowerInvariant();
            DateTimeOffset valid = new DateTimeOffset(certificate.NotBefore.ToUniversalTime()).AddDays(1);
            PinVerifier verify = (PinVerifier)typeof(PresentationRealtimeConnection)
                .GetMethod("VerifyCertificate", BindingFlags.NonPublic | BindingFlags.Static)
                .CreateDelegate(typeof(PinVerifier));

            Assert.That(verify("127.0.0.1", "127.0.0.1", der, valid, pin), Is.True);
            Assert.That(verify("127.0.0.1", "127.0.0.1", der, valid, "sha256:" + new string('0', 64)), Is.False);
            Assert.That(verify("127.0.0.1", "other.example.test", der, valid, pin), Is.False);
            Assert.That(verify("127.0.0.1", "127.0.0.1", der, new DateTimeOffset(certificate.NotAfter.ToUniversalTime()).AddDays(1), pin), Is.False);
        }
    }
}
