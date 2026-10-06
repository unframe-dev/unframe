using System;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationEncodedAssetCacheEditModeTests
{
    private string directory;

    [SetUp]
    public void SetUp()
    {
        directory = Path.Combine(Path.GetTempPath(), "unframe-encoded-cache-test-" + Guid.NewGuid().ToString("N"));
    }

    [TearDown]
    public void TearDown()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    [Test]
    public async Task AdmissionRequiresCompleteHostRecoveryAndVerifiedBytesSurviveRestart()
    {
        byte[] bytes = { 1, 2, 3 };
        AssetAccessBinding asset = Asset(bytes);
        var cache = NewCache(10);
        Assert.That(cache.TryReserveSession("session:a", new[] { asset }, out _, out string error), Is.False);
        Assert.That(error, Is.EqualTo("asset-cache-not-ready"));
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        Assert.That(cache.TryReserveSession("session:a", new[] { asset }, out var lease, out error), Is.True, error);
        using (lease)
            Assert.That(await lease.GetAsync(asset, (_, _) => Task.FromResult(bytes), CancellationToken.None), Is.EqualTo(bytes));

        cache.Dispose();
        var restarted = NewCache(10);
        Assert.That(restarted.TryReserveSession("session:b", new[] { asset }, out _, out error), Is.False);
        restarted.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        Assert.That(restarted.TryReserveSession("session:b", new[] { asset }, out var recovered, out error), Is.True, error);
        using (recovered)
            Assert.That(await recovered.GetAsync(asset, (_, _) => throw new AssertionException("verified cache should be reused"), CancellationToken.None), Is.EqualTo(bytes));
        restarted.Dispose();
    }

    [Test]
    public async Task TwoConsumersShareReservationAndOneCancellationDoesNotAbortTheOther()
    {
        byte[] bytes = { 4, 5, 6 };
        AssetAccessBinding asset = Asset(bytes);
        var cache = NewCache(10);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        Assert.That(cache.TryReserveSession("session:a", new[] { asset }, out var first, out string error), Is.True, error);
        Assert.That(cache.TryReserveSession("session:b", new[] { asset }, out var second, out error), Is.True, error);
        var pending = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        int downloads = 0;
        Func<AssetAccessBinding, CancellationToken, Task<byte[]>> download = (_, _) => { downloads++; return pending.Task; };
        Task<byte[]> firstRequest = first.GetAsync(asset, download, CancellationToken.None);
        Task<byte[]> secondRequest = second.GetAsync(asset, download, CancellationToken.None);
        first.Dispose();
        pending.SetResult(bytes);
        Assert.That(await secondRequest, Is.EqualTo(bytes));
        Assert.That(downloads, Is.EqualTo(1));
        second.Dispose();
        Assert.That(await firstRequest, Is.EqualTo(bytes));
    }

    [Test]
    public async Task UnpinnedLruEvictsOldestVerifiedEntryWithinHardLimit()
    {
        byte[] a = { 1, 1, 1 }, b = { 2, 2, 2 }, c = { 3, 3, 3 };
        var cache = NewCache(6);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        await Store(cache, "session:a", Asset(a), a);
        await Store(cache, "session:b", Asset(b), b);
        await Store(cache, "session:c", Asset(c), c);
        Assert.That(File.Exists(Path.Combine(directory, Asset(a).Checksum.Substring(7) + ".bin")), Is.False);
        Assert.That(File.Exists(Path.Combine(directory, Asset(b).Checksum.Substring(7) + ".bin")), Is.True);
        Assert.That(File.Exists(Path.Combine(directory, Asset(c).Checksum.Substring(7) + ".bin")), Is.True);
    }

    [Test]
    public void LowSpaceReserveRejectsAdmissionWithoutPartialReservation()
    {
        var cache = NewCache(10, 4, 5);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        Assert.That(cache.TryReserveSession("session:a", new[] { Asset(new byte[] { 1, 2, 3 }) }, out _, out string error), Is.False);
        Assert.That(error, Is.EqualTo("asset-cache-admission-exceeded"));
        Assert.That(Directory.GetFiles(directory, "*.part"), Is.Empty);
    }

    [Test]
    public void WrongDownloadHashNeverBecomesVerified()
    {
        var cache = NewCache(10);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        AssetAccessBinding asset = Asset(new byte[] { 1, 2, 3 });
        Assert.That(cache.TryReserveSession("session:a", new[] { asset }, out var lease, out string error), Is.True, error);
        using (lease)
            Assert.ThrowsAsync<InvalidOperationException>(async () => await lease.GetAsync(asset,
                (_, _) => Task.FromResult(new byte[] { 3, 2, 1 }), CancellationToken.None));
        Assert.That(Directory.GetFiles(directory, "*.bin"), Is.Empty);
    }

    [Test]
    public async Task SelectedCacheHitIsNeverEvictedToMakeRoomForAnotherSelectedAsset()
    {
        byte[] a = { 1, 1, 1 }, b = { 2, 2, 2 };
        var cache = NewCache(5);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        await Store(cache, "session:old", Asset(a), a);
        Assert.That(cache.TryReserveSession("session:new", new[] { Asset(a), Asset(b) }, out _, out string error), Is.False);
        Assert.That(error, Is.EqualTo("asset-cache-admission-exceeded"));
        Assert.That(File.Exists(Path.Combine(directory, Asset(a).Checksum.Substring(7) + ".bin")), Is.True);
    }

    [Test]
    public async Task CancellingOneConsumerRemovesItsPinWithoutStoppingTheSharedDownload()
    {
        byte[] bytes = { 9, 8, 7 };
        AssetAccessBinding asset = Asset(bytes);
        var cache = NewCache(10);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        Assert.That(cache.TryReserveSession("session:a", new[] { asset }, out var first, out string error), Is.True, error);
        Assert.That(cache.TryReserveSession("session:b", new[] { asset }, out var second, out error), Is.True, error);
        var pending = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        using (var cancel = new CancellationTokenSource())
        {
            Task<byte[]> abandoned = first.GetAsync(asset, (_, _) => pending.Task, cancel.Token);
            Task<byte[]> retained = second.GetAsync(asset, (_, _) => pending.Task, CancellationToken.None);
            cancel.Cancel();
            Assert.CatchAsync<OperationCanceledException>(async () => await abandoned);
            pending.SetResult(bytes);
            Assert.That(await retained, Is.EqualTo(bytes));
            first.Dispose();
            second.Dispose();
        }
        Assert.That(cache.TryReserveSession("session:a", new[] { asset }, out var next, out error), Is.True, error);
        next.Dispose();
    }

    [Test]
    public void ASecondOwnerCannotOpenTheSameDirectoryUntilTheFirstReleasesIt()
    {
        var first = NewCache(10);
        Assert.Throws<InvalidOperationException>(() => NewCache(10));
        first.Dispose();
        var second = NewCache(10);
        second.Dispose();
    }

    [Test]
    public void RecoveryFailureCanRetryWithoutRetainingHalfVerifiedMetadata()
    {
        byte[] a = { 1 }, b = { 2 };
        AssetAccessBinding first = Asset(a), second = Asset(b);
        Directory.CreateDirectory(directory);
        File.WriteAllBytes(Path.Combine(directory, first.Checksum.Substring(7) + ".bin"), a);
        File.WriteAllText(Path.Combine(directory, "metadata.json"), JsonConvert.SerializeObject(new
        {
            LastAccessSequence = 2,
            LastLeaseGeneration = 0,
            Verified = new[] {
                new { Checksum = first.Checksum, Bytes = 1, LastAccessSequence = 1 },
                new { Checksum = second.Checksum, Bytes = 1, LastAccessSequence = 2 },
            },
            Reservations = Array.Empty<object>(),
        }));
        var cache = NewCache(10);
        Assert.Throws<InvalidOperationException>(() => cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>()));
        File.WriteAllBytes(Path.Combine(directory, second.Checksum.Substring(7) + ".bin"), b);
        Assert.DoesNotThrow(() => cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>()));
        cache.Dispose();
    }

    [Test]
    public void FailedMetadataCommitLeavesCacheNotReadyAndReturnsNoLease()
    {
        var cache = NewCache(10);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        string metadata = Path.Combine(directory, "metadata.json");
        File.Delete(metadata);
        Directory.CreateDirectory(metadata);
        Assert.Throws<IOException>(() => cache.TryReserveSession("session:a", new[] { Asset(new byte[] { 1, 2, 3 }) }, out _, out _));
        Assert.That(cache.IsReady, Is.False);
        cache.Dispose();
    }

    [Test]
    public void FailedDownloadCommitNeverPromotesBytesOrRemainsReady()
    {
        byte[] bytes = { 1, 2, 3 };
        var cache = NewCache(10);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        AssetAccessBinding asset = Asset(bytes);
        Assert.That(cache.TryReserveSession("session:a", new[] { asset }, out var lease, out string error), Is.True, error);
        string metadata = Path.Combine(directory, "metadata.json");
        File.Delete(metadata);
        Directory.CreateDirectory(metadata);
        Assert.ThrowsAsync<IOException>(async () => await lease.GetAsync(asset, (_, _) => Task.FromResult(bytes), CancellationToken.None));
        Assert.That(cache.IsReady, Is.False);
        Assert.That(Directory.GetFiles(directory, "*.bin"), Is.Empty);
        lease.Dispose();
        cache.Dispose();
    }

    [Test]
    public async Task CorruptedVerifiedFileClosesTheCacheBeforeAnotherAdmission()
    {
        byte[] bytes = { 1, 2, 3 };
        AssetAccessBinding asset = Asset(bytes);
        var cache = NewCache(10);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        await Store(cache, "session:first", asset, bytes);
        File.WriteAllBytes(Path.Combine(directory, asset.Checksum.Substring(7) + ".bin"), new byte[] { 3, 2, 1 });
        Assert.That(cache.TryReserveSession("session:second", new[] { asset }, out var lease, out string error), Is.True, error);
        Assert.ThrowsAsync<InvalidOperationException>(async () => await lease.GetAsync(asset,
            (_, _) => throw new AssertionException("corrupt cache entry must not be redownloaded"), CancellationToken.None));
        Assert.That(cache.IsReady, Is.False);
        lease.Dispose();
        cache.Dispose();
    }

    [Test]
    public async Task DisposedOwnerCannotDeleteAFileCommittedByTheNextOwner()
    {
        byte[] bytes = { 1, 2, 3 };
        AssetAccessBinding asset = Asset(bytes);
        var previous = NewCache(10);
        previous.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        Assert.That(previous.TryReserveSession("session:old", new[] { asset }, out var staleLease, out string error), Is.True, error);
        var delayed = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        Task<byte[]> staleDownload = staleLease.GetAsync(asset, (_, _) => delayed.Task, CancellationToken.None);
        previous.Dispose();

        var current = NewCache(10);
        current.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        await Store(current, "session:new", asset, bytes);
        delayed.SetResult(bytes);
        try
        {
            await staleDownload;
            Assert.Fail("disposed owner's download must not complete");
        }
        catch (OperationCanceledException) { }
        Assert.That(File.Exists(Path.Combine(directory, asset.Checksum.Substring(7) + ".bin")), Is.True);
        current.Dispose();
    }

    [Test]
    public async Task ReleasedDownloadCannotDeleteAFileCommittedByANewerReservation()
    {
        byte[] bytes = { 1, 2, 3 };
        AssetAccessBinding asset = Asset(bytes);
        using (var cache = NewCache(10))
        {
            cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
            Assert.That(cache.TryReserveSession("session:old", new[] { asset }, out var staleLease, out string error), Is.True, error);
            var delayed = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
            Task<byte[]> staleDownload = staleLease.GetAsync(asset, (_, _) => delayed.Task, CancellationToken.None);
            staleLease.Dispose();

            Assert.That(cache.TryReserveSession("session:new", new[] { asset }, out var currentLease, out error), Is.True, error);
            using (currentLease)
            {
                Assert.That(await currentLease.GetAsync(asset, (_, _) => Task.FromResult(bytes), CancellationToken.None), Is.EqualTo(bytes));
                delayed.SetResult(bytes);
                Assert.ThrowsAsync<OperationCanceledException>(async () => await staleDownload);
                Assert.That(File.Exists(Path.Combine(directory, asset.Checksum.Substring(7) + ".bin")), Is.True);
                Assert.That(await currentLease.GetAsync(asset, (_, _) => throw new AssertionException("verified bytes must remain cached"), CancellationToken.None), Is.EqualTo(bytes));
                Assert.That(cache.IsReady, Is.True);
            }
        }
    }

    [Test]
    public async Task DurableSelectionSurvivesLeaseReleaseUntilHostRemovesIt()
    {
        byte[] a = { 1, 1, 1 }, b = { 2, 2, 2 };
        AssetAccessBinding pinned = Asset(a), other = Asset(b);
        var cache = NewCache(3);
        cache.RecoverSessions(Array.Empty<PresentationEncodedAssetCache.SessionSelection>());
        Assert.That(cache.ReplaceSelection("session:a", new[] { pinned }, out string error), Is.True, error);
        await Store(cache, "session:a", pinned, a);
        Assert.That(cache.TryReserveSession("session:b", new[] { other }, out _, out error), Is.False);
        Assert.That(error, Is.EqualTo("asset-cache-admission-exceeded"));
        cache.RemoveSelection("session:a");
        await Store(cache, "session:b", other, b);
        cache.Dispose();
    }

    private PresentationEncodedAssetCache NewCache(ulong hard, ulong reserve = 0, ulong free = 100)
    {
        return new PresentationEncodedAssetCache(directory, hard, reserve, () => free);
    }

    private static async Task Store(PresentationEncodedAssetCache cache, string token, AssetAccessBinding asset, byte[] bytes)
    {
        Assert.That(cache.TryReserveSession(token, new[] { asset }, out var lease, out string error), Is.True, error);
        using (lease) await lease.GetAsync(asset, (_, _) => Task.FromResult(bytes), CancellationToken.None);
    }

    private static AssetAccessBinding Asset(byte[] bytes)
    {
        using (var sha = SHA256.Create())
            return new AssetAccessBinding
            {
                AssetId = "asset:test",
                Checksum = "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(),
                EncodedSizeBytes = (ulong)bytes.LongLength,
                MediaType = "image/png",
            };
    }
}
