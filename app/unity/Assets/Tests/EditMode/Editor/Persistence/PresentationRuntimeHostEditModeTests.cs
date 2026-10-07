using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationRuntimeHostEditModeTests
{
    private string directory;

    [SetUp]
    public void SetUp() { directory = Path.Combine(Path.GetTempPath(), "unframe-host-test-" + Guid.NewGuid().ToString("N")); }

    [TearDown]
    public void TearDown() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    private PresentationEncodedAssetCache Cache() => new PresentationEncodedAssetCache(Path.Combine(directory, "cache"), 1024, 0, () => 4096);
    private string RegistryPath => Path.Combine(directory, "selections.json");

    [Test]
    public void FreshDeliveryRecoversCacheAndPersistsOnlySelectionMetadata()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        using (PresentationEncodedAssetCache cache = Cache())
        using (PresentationRuntimeHost host = new PresentationRuntimeHost(RegistryPath, cache))
        {
            Assert.That(cache.IsReady, Is.True);
            host.PrepareDelivery(delivery);
            AssetAccessBinding asset = delivery.AssetAccess.Single(item => item.AssetId == "asset:texture");
            Assert.That(cache.TryReserveSession(PresentationRuntimeHost.ConsumerToken(delivery.SessionId, delivery.ProjectionInstance.ParticipantId),
                new[] { asset }, out var lease, out string error), Is.True, error);
            lease.Dispose();
            string persisted = File.ReadAllText(RegistryPath);
            Assert.That(persisted, Does.Contain(asset.Checksum));
            Assert.That(persisted, Does.Not.Contain("https://"));
            Assert.That(persisted, Does.Not.Contain("Bearer"));
        }
    }

    [Test]
    public void ExistingSelectionsSurviveRestartAndCancellationRemovesOnlyConfirmedConsumer()
    {
        DeliveryManifest first = PresentationTextureResidencyEditModeTests.BakedDelivery();
        DeliveryManifest second = first.Clone();
        second.SessionId = "another-session";
        string firstToken = PresentationRuntimeHost.ConsumerToken(first.SessionId, first.ProjectionInstance.ParticipantId);
        string secondToken = PresentationRuntimeHost.ConsumerToken(second.SessionId, second.ProjectionInstance.ParticipantId);
        AssetAccessBinding asset = first.AssetAccess.Single(item => item.AssetId == "asset:texture");
        using (PresentationEncodedAssetCache cache = Cache())
        using (PresentationRuntimeHost host = new PresentationRuntimeHost(RegistryPath, cache))
        {
            host.PrepareDelivery(first);
            host.PrepareDelivery(second);
            Assert.That(host.SelectionCount, Is.EqualTo(2));
        }
        using (PresentationEncodedAssetCache restarted = Cache())
        using (PresentationRuntimeHost host = new PresentationRuntimeHost(RegistryPath, restarted))
        {
            Assert.That(host.SelectionCount, Is.EqualTo(2));
            Assert.That(restarted.TryReserveSession(firstToken, new[] { asset }, out var firstLease, out string firstError), Is.True, firstError);
            Assert.That(restarted.TryReserveSession(secondToken, new[] { asset }, out var secondLease, out string secondError), Is.True, secondError);
            firstLease.Dispose();
            secondLease.Dispose();
            host.RemoveConfirmedSelection(first.SessionId, first.ProjectionInstance.ParticipantId);
            Assert.That(host.SelectionCount, Is.EqualTo(1));
            Assert.That(File.ReadAllText(RegistryPath), Does.Contain(second.SessionId));
            Assert.That(File.ReadAllText(RegistryPath), Does.Not.Contain(first.SessionId));
        }
    }

    [Test]
    public void CorruptRegistryFailsClosedBeforeCacheRecovery()
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(RegistryPath, "{\"version\":1,\"selections\":[],\"selections\":[]}");
        using (PresentationEncodedAssetCache cache = Cache())
        {
            Assert.Throws<InvalidOperationException>(() => new PresentationRuntimeHost(RegistryPath, cache));
            Assert.That(cache.IsReady, Is.False);
        }
    }

    [Test]
    public void AValidatedDeliveryReloadReplacesOnlyItsOwnPublicationSelection()
    {
        DeliveryManifest current = PresentationTextureResidencyEditModeTests.BakedDelivery();
        DeliveryManifest other = current.Clone();
        other.SessionId = "other-session";
        DeliveryManifest reloaded = current.Clone();
        reloaded.Publication.PublicationEpoch++;
        reloaded.ProjectionProfile.Key.Publication = reloaded.Publication.Clone();
        using (PresentationEncodedAssetCache cache = Cache())
        using (PresentationRuntimeHost host = new PresentationRuntimeHost(RegistryPath, cache))
        {
            host.PrepareDelivery(current);
            host.PrepareDelivery(other);
            host.PrepareDelivery(reloaded);
            Assert.That(host.SelectionCount, Is.EqualTo(2));
            string persisted = File.ReadAllText(RegistryPath);
            Assert.That(persisted, Does.Contain("\"publicationEpoch\":" + reloaded.Publication.PublicationEpoch));
            Assert.That(persisted, Does.Contain(other.SessionId));
            DeliveryManifest invalid = reloaded.Clone();
            invalid.Residency.Textures.TotalDecodedGpuBytes = 0;
            Assert.Throws<InvalidOperationException>(() => host.PrepareDelivery(invalid));
            Assert.That(File.ReadAllText(RegistryPath), Is.EqualTo(persisted));
            Assert.Throws<InvalidOperationException>(() => host.PrepareDelivery(current));
            Assert.That(File.ReadAllText(RegistryPath), Is.EqualTo(persisted));
            Assert.Throws<InvalidOperationException>(() => { _ = host.SelectionCount; });
        }
    }

    [Test]
    public void ColonBearingSessionAndParticipantIdsCannotReplaceAnotherSelection()
    {
        DeliveryManifest first = PresentationTextureResidencyEditModeTests.BakedDelivery();
        first.SessionId = "a:b";
        first.ProjectionInstance.ParticipantId = "c";
        DeliveryManifest second = first.Clone();
        second.SessionId = "a";
        second.ProjectionInstance.ParticipantId = "b:c";
        using (PresentationEncodedAssetCache cache = Cache())
        using (PresentationRuntimeHost host = new PresentationRuntimeHost(RegistryPath, cache))
        {
            host.PrepareDelivery(first);
            host.PrepareDelivery(second);
            Assert.That(host.SelectionCount, Is.EqualTo(2));
            Assert.That(PresentationRuntimeHost.ConsumerToken(first.SessionId, first.ProjectionInstance.ParticipantId),
                Is.Not.EqualTo(PresentationRuntimeHost.ConsumerToken(second.SessionId, second.ProjectionInstance.ParticipantId)));
            host.RemoveConfirmedSelection(first.SessionId, first.ProjectionInstance.ParticipantId);
            Assert.That(host.SelectionCount, Is.EqualTo(1));
        }
    }

    [TestCase("missing-version")]
    [TestCase("nested-unknown")]
    [TestCase("numeric-string")]
    [TestCase("bad-id")]
    public void IncompleteOrCoercedRegistryRecordsFailClosed(string corruption)
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        using (PresentationEncodedAssetCache cache = Cache())
        using (PresentationRuntimeHost host = new PresentationRuntimeHost(RegistryPath, cache)) host.PrepareDelivery(delivery);
        JObject document = JObject.Parse(File.ReadAllText(RegistryPath));
        JObject selection = (JObject)document["selections"][0];
        switch (corruption)
        {
            case "missing-version": document.Remove("version"); break;
            case "nested-unknown": ((JObject)selection["assets"][0])["signedUrl"] = "https://example.invalid/private"; break;
            case "numeric-string": selection["publicationEpoch"] = "1"; break;
            case "bad-id": selection["sessionId"] = "bad id"; break;
        }
        File.WriteAllText(RegistryPath, document.ToString());
        using (PresentationEncodedAssetCache restarted = Cache())
        {
            Assert.Throws<InvalidOperationException>(() => new PresentationRuntimeHost(RegistryPath, restarted));
            Assert.That(restarted.IsReady, Is.False);
        }
    }
}
