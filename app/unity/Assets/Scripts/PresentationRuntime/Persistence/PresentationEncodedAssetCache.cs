using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Unframe.Delivery;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationEncodedAssetCache : IDisposable
    {
        public const ulong BaselineHardLimitBytes = 4UL * 1024 * 1024 * 1024;
        public const ulong BaselineLowSpaceReserveBytes = 512UL * 1024 * 1024;

        public sealed class SessionSelection
        {
            public string ConsumerToken { get; }
            public IReadOnlyList<AssetAccessBinding> Assets { get; }

            public SessionSelection(string consumerToken, IReadOnlyList<AssetAccessBinding> assets)
            {
                ConsumerToken = consumerToken;
                Assets = assets;
            }
        }

        public sealed class Lease : IDisposable
        {
            private PresentationEncodedAssetCache cache;
            private readonly string consumerToken;
            internal Lease(PresentationEncodedAssetCache cache, string consumerToken)
            {
                this.cache = cache;
                this.consumerToken = consumerToken;
            }

            public Task<byte[]> GetAsync(AssetAccessBinding asset, Func<AssetAccessBinding, CancellationToken, Task<byte[]>> download, CancellationToken token)
            {
                if (cache == null) throw new ObjectDisposedException(nameof(Lease));
                return cache.GetAsync(consumerToken, asset, download, token);
            }

            public void Dispose()
            {
                PresentationEncodedAssetCache owner = Interlocked.Exchange(ref cache, null);
                owner?.Release(consumerToken);
            }
        }

        private sealed class VerifiedEntry
        {
            public string Checksum { get; set; }
            public ulong Bytes { get; set; }
            public ulong LastAccessSequence { get; set; }
        }

        private sealed class ReservationRecord
        {
            public string Checksum { get; set; }
            public ulong ExpectedBytes { get; set; }
            public ulong StagingBytes { get; set; }
            public ulong RemainingBytes { get; set; }
            public long CreatedAtUnixMillis { get; set; }
            public long LeaseRenewedAtUnixMillis { get; set; }
            public ulong Generation { get; set; }
            public List<string> Consumers { get; set; } = new List<string>();
        }

        private sealed class Metadata
        {
            public ulong LastAccessSequence { get; set; }
            public ulong LastLeaseGeneration { get; set; }
            public List<VerifiedEntry> Verified { get; set; } = new List<VerifiedEntry>();
            public List<ReservationRecord> Reservations { get; set; } = new List<ReservationRecord>();
        }

        private sealed class Reservation
        {
            public ReservationRecord Record;
            public CancellationTokenSource Cancellation = new CancellationTokenSource();
            public Task<byte[]> Download;
            public double RenewedAtMonotonic;
        }

        private readonly object gate = new object();
        private readonly string directory;
        private readonly string metadataPath;
        private readonly FileStream directoryLock;
        private readonly Func<ulong> freeBytes;
        private readonly ulong hardLimitBytes;
        private readonly ulong lowSpaceReserveBytes;
        private readonly Dictionary<string, VerifiedEntry> verified = new Dictionary<string, VerifiedEntry>(StringComparer.Ordinal);
        private readonly Dictionary<string, Reservation> reservations = new Dictionary<string, Reservation>(StringComparer.Ordinal);
        private readonly Dictionary<string, HashSet<string>> sessionPins = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        private readonly Dictionary<string, HashSet<string>> durablePins = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        private readonly Dictionary<string, Dictionary<string, ulong>> durableSelectionSizes = new Dictionary<string, Dictionary<string, ulong>>(StringComparer.Ordinal);
        private Metadata metadata;
        private bool recovered;
        private bool faulted;
        private bool disposed;
        private Timer sweepTimer;
        private double lastSweepMonotonic;

        private static readonly object sharedGate = new object();
        private static PresentationEncodedAssetCache shared;
        public static PresentationEncodedAssetCache Shared
        {
            get
            {
                lock (sharedGate)
                {
                    if (shared == null || shared.disposed)
                        shared = new PresentationEncodedAssetCache(Path.Combine(Application.persistentDataPath, "unframe", "encoded-cache"));
                    return shared;
                }
            }
        }

        static PresentationEncodedAssetCache()
        {
            Application.quitting += DisposeShared;
#if UNITY_EDITOR
            UnityEditor.AssemblyReloadEvents.beforeAssemblyReload += DisposeShared;
            UnityEditor.EditorApplication.playModeStateChanged += state =>
            {
                if (state == UnityEditor.PlayModeStateChange.ExitingPlayMode) DisposeShared();
            };
#endif
        }

        private static void DisposeShared()
        {
            lock (sharedGate)
            {
                shared?.Dispose();
                shared = null;
            }
        }
        public bool IsReady { get { lock (gate) return recovered && !faulted && !disposed; } }
        private static double MonotonicSeconds { get { return (double)Stopwatch.GetTimestamp() / Stopwatch.Frequency; } }

        public PresentationEncodedAssetCache(string directory, ulong hardLimitBytes = BaselineHardLimitBytes,
            ulong lowSpaceReserveBytes = BaselineLowSpaceReserveBytes, Func<ulong> freeBytes = null)
        {
            if (string.IsNullOrWhiteSpace(directory) || hardLimitBytes == 0 || hardLimitBytes > BaselineHardLimitBytes
                || lowSpaceReserveBytes > BaselineLowSpaceReserveBytes) throw new ArgumentException("Invalid encoded cache configuration.");
            this.directory = Path.GetFullPath(directory);
            this.metadataPath = Path.Combine(this.directory, "metadata.json");
            this.hardLimitBytes = hardLimitBytes;
            this.lowSpaceReserveBytes = lowSpaceReserveBytes;
            this.freeBytes = freeBytes ?? (() => checked((ulong)new DriveInfo(Path.GetPathRoot(this.directory)).AvailableFreeSpace));
            Directory.CreateDirectory(this.directory);
            try
            {
                directoryLock = new FileStream(Path.Combine(this.directory, "owner.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                metadata = File.Exists(metadataPath) ? JsonConvert.DeserializeObject<Metadata>(File.ReadAllText(metadataPath)) : new Metadata();
                if (metadata == null || metadata.Verified == null || metadata.Reservations == null)
                    throw new InvalidOperationException("asset-cache-metadata-invalid");
            }
            catch (IOException exception) { directoryLock?.Dispose(); throw new InvalidOperationException("asset-cache-not-ready", exception); }
            catch { directoryLock?.Dispose(); throw; }
        }

        public void RecoverSessions(IEnumerable<SessionSelection> completeActiveAndWaitingSessions)
        {
            if (completeActiveAndWaitingSessions == null) throw new ArgumentNullException(nameof(completeActiveAndWaitingSessions));
            lock (gate)
            {
                if (disposed) throw new ObjectDisposedException(nameof(PresentationEncodedAssetCache));
                if (recovered) throw new InvalidOperationException("Cache session recovery already completed.");
                var restored = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
                var restoredSizes = new Dictionary<string, Dictionary<string, ulong>>(StringComparer.Ordinal);
                var allSizes = new Dictionary<string, ulong>(StringComparer.Ordinal);
                foreach (SessionSelection selection in completeActiveAndWaitingSessions)
                {
                    if (!TrySelection(selection?.ConsumerToken, selection?.Assets, out HashSet<string> pins, out Dictionary<string, ulong> sizes)
                        || !restored.TryAdd(selection.ConsumerToken, pins)) throw new InvalidOperationException("asset-descriptor-conflict");
                    foreach (KeyValuePair<string, ulong> item in sizes)
                        if (allSizes.TryGetValue(item.Key, out ulong previous) && previous != item.Value)
                            throw new InvalidOperationException("asset-descriptor-conflict");
                        else allSizes[item.Key] = item.Value;
                    restoredSizes.Add(selection.ConsumerToken, sizes);
                }
                foreach (string path in Directory.GetFiles(directory, "*.part")) File.Delete(path);
                foreach (string path in Directory.GetFiles(directory, "metadata.*.tmp")) File.Delete(path);
                metadata.Reservations.Clear();
                var restoredVerified = new Dictionary<string, VerifiedEntry>(StringComparer.Ordinal);
                foreach (VerifiedEntry entry in metadata.Verified)
                {
                    if (!ValidChecksum(entry.Checksum) || restoredVerified.ContainsKey(entry.Checksum)
                        || !VerifiedFile(entry.Checksum, entry.Bytes)) throw new InvalidOperationException("asset-cache-metadata-invalid");
                    if (allSizes.TryGetValue(entry.Checksum, out ulong selectedBytes) && selectedBytes != entry.Bytes)
                        throw new InvalidOperationException("asset-descriptor-conflict");
                    restoredVerified.Add(entry.Checksum, entry);
                }
                foreach (string path in Directory.GetFiles(directory, "*.bin"))
                    if (!restoredVerified.ContainsKey("sha256:" + Path.GetFileNameWithoutExtension(path))) File.Delete(path);
                foreach (KeyValuePair<string, VerifiedEntry> entry in restoredVerified) verified.Add(entry.Key, entry.Value);
                foreach (KeyValuePair<string, HashSet<string>> session in restored) durablePins.Add(session.Key, session.Value);
                foreach (KeyValuePair<string, Dictionary<string, ulong>> session in restoredSizes) durableSelectionSizes.Add(session.Key, session.Value);
                try { Persist(); }
                catch
                {
                    verified.Clear();
                    durablePins.Clear();
                    durableSelectionSizes.Clear();
                    throw;
                }
                recovered = true;
                lastSweepMonotonic = MonotonicSeconds;
                sweepTimer = new Timer(_ => SweepTimer(), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
            }
        }

        public bool ReplaceSelection(string consumerToken, IReadOnlyList<AssetAccessBinding> selected, out string error)
        {
            error = "asset-cache-not-ready";
            lock (gate)
            {
                if (!IsReady) return false;
                if (!TrySelection(consumerToken, selected, out HashSet<string> pins, out Dictionary<string, ulong> sizes))
                { error = "asset-descriptor-conflict"; return false; }
                foreach (KeyValuePair<string, ulong> item in sizes)
                {
                    if (verified.TryGetValue(item.Key, out VerifiedEntry existing) && existing.Bytes != item.Value
                        || reservations.TryGetValue(item.Key, out Reservation pending) && pending.Record.ExpectedBytes != item.Value
                        || durableSelectionSizes.Any(session => session.Key != consumerToken
                            && session.Value.TryGetValue(item.Key, out ulong previous) && previous != item.Value))
                    { error = "asset-descriptor-conflict"; return false; }
                }
                durablePins[consumerToken] = pins;
                durableSelectionSizes[consumerToken] = sizes;
                error = null;
                return true;
            }
        }

        public void RemoveSelection(string consumerToken)
        {
            lock (gate)
            {
                if (!IsReady) throw new InvalidOperationException("asset-cache-not-ready");
                durablePins.Remove(consumerToken);
                durableSelectionSizes.Remove(consumerToken);
            }
        }

        public bool TryReserveSession(string consumerToken, IReadOnlyList<AssetAccessBinding> selected, out Lease lease, out string error)
        {
            lease = null;
            error = "asset-cache-not-ready";
            lock (gate)
            {
                if (!IsReady) return false;
                if (!TrySelection(consumerToken, selected, out HashSet<string> pins, out Dictionary<string, ulong> sizes))
                { error = "asset-descriptor-conflict"; return false; }
                if (durablePins.TryGetValue(consumerToken, out HashSet<string> selectedByHost) && !selectedByHost.SetEquals(pins))
                { error = "asset-descriptor-conflict"; return false; }
                if (durableSelectionSizes.TryGetValue(consumerToken, out Dictionary<string, ulong> hostSizes)
                    && sizes.Any(item => hostSizes[item.Key] != item.Value))
                { error = "asset-descriptor-conflict"; return false; }
                bool alreadyPinned = sessionPins.TryGetValue(consumerToken, out HashSet<string> existing);
                if (alreadyPinned)
                {
                    if (!existing.SetEquals(pins)) { error = "asset-descriptor-conflict"; return false; }
                }
                try { Sweep(); }
                catch { faulted = true; throw; }
                ulong required = 0;
                foreach (KeyValuePair<string, ulong> item in sizes)
                {
                    if (verified.TryGetValue(item.Key, out VerifiedEntry entry))
                    { if (entry.Bytes != item.Value) { error = "asset-descriptor-conflict"; return false; } }
                    else if (reservations.TryGetValue(item.Key, out Reservation pending))
                    { if (pending.Record.ExpectedBytes != item.Value) { error = "asset-descriptor-conflict"; return false; } }
                    else { try { required = checked(required + item.Value); } catch (OverflowException) { error = "asset-cache-admission-exceeded"; return false; } }
                }
                var evict = new List<VerifiedEntry>();
                try
                {
                    ulong verifiedBytes = 0, staging = 0, remaining = 0, evicted = 0;
                    foreach (VerifiedEntry entry in verified.Values) verifiedBytes = checked(verifiedBytes + entry.Bytes);
                    foreach (Reservation pending in reservations.Values)
                    {
                        staging = checked(staging + pending.Record.StagingBytes);
                        remaining = checked(remaining + pending.Record.RemainingBytes);
                    }
                    ulong free = freeBytes();
                    foreach (VerifiedEntry candidate in verified.Values.Where(entry => !Pinned(entry.Checksum) && !pins.Contains(entry.Checksum))
                        .OrderBy(entry => entry.LastAccessSequence).ThenBy(entry => entry.Checksum, StringComparer.Ordinal))
                    {
                        if (Fits(verifiedBytes, staging, remaining, required, evicted, free)) break;
                        evict.Add(candidate);
                        evicted = checked(evicted + candidate.Bytes);
                    }
                    if (!Fits(verifiedBytes, staging, remaining, required, evicted, free))
                    { error = "asset-cache-admission-exceeded"; return false; }
                }
                catch (OverflowException) { error = "asset-cache-admission-exceeded"; return false; }
                ulong previousLeaseGeneration = metadata.LastLeaseGeneration;
                var originalReservations = new HashSet<string>(reservations.Keys, StringComparer.Ordinal);
                var previousConsumers = reservations.ToDictionary(item => item.Key,
                    item => new List<string>(item.Value.Record.Consumers), StringComparer.Ordinal);
                try
                {
                    foreach (VerifiedEntry entry in evict) verified.Remove(entry.Checksum);
                    if (!alreadyPinned) sessionPins.Add(consumerToken, pins);
                    foreach (KeyValuePair<string, ulong> item in sizes)
                    {
                        if (verified.ContainsKey(item.Key)) continue;
                        if (!reservations.TryGetValue(item.Key, out Reservation pending))
                        {
                            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                            pending = new Reservation
                            {
                                Record = new ReservationRecord
                                {
                                    Checksum = item.Key,
                                    ExpectedBytes = item.Value,
                                    RemainingBytes = item.Value,
                                    CreatedAtUnixMillis = now,
                                    LeaseRenewedAtUnixMillis = now,
                                    Generation = checked(++metadata.LastLeaseGeneration),
                                },
                                RenewedAtMonotonic = MonotonicSeconds
                            };
                            reservations.Add(item.Key, pending);
                        }
                        if (!pending.Record.Consumers.Contains(consumerToken)) pending.Record.Consumers.Add(consumerToken);
                    }
                    Persist();
                    foreach (VerifiedEntry entry in evict) File.Delete(AssetPath(entry.Checksum));
                    lease = new Lease(this, consumerToken);
                    error = null;
                    return true;
                }
                catch
                {
                    faulted = true;
                    if (!alreadyPinned) sessionPins.Remove(consumerToken);
                    foreach (string checksum in reservations.Keys.ToArray())
                    {
                        if (!originalReservations.Contains(checksum))
                        {
                            reservations[checksum].Cancellation.Dispose();
                            reservations.Remove(checksum);
                        }
                        else
                        {
                            reservations[checksum].Record.Consumers = previousConsumers[checksum];
                        }
                    }
                    metadata.LastLeaseGeneration = previousLeaseGeneration;
                    foreach (VerifiedEntry entry in evict)
                        if (File.Exists(AssetPath(entry.Checksum))) verified[entry.Checksum] = entry;
                    throw;
                }
            }
        }

        private async Task<byte[]> GetAsync(string consumerToken, AssetAccessBinding asset,
            Func<AssetAccessBinding, CancellationToken, Task<byte[]>> download, CancellationToken token)
        {
            if (asset == null || download == null) throw new ArgumentException("Asset and downloader are required.");
            if (token.IsCancellationRequested) { Release(consumerToken); token.ThrowIfCancellationRequested(); }
            Task<byte[]> sharedDownload = null;
            lock (gate)
            {
                if (!IsReady) throw new InvalidOperationException("asset-cache-not-ready");
                if (!sessionPins.TryGetValue(consumerToken, out HashSet<string> pins) || !pins.Contains(asset.Checksum))
                    throw new InvalidOperationException("asset-cache-not-ready");
                if (verified.TryGetValue(asset.Checksum, out VerifiedEntry entry))
                {
                    byte[] bytes;
                    try
                    {
                        bytes = File.ReadAllBytes(AssetPath(entry.Checksum));
                        if (entry.Bytes != asset.EncodedSizeBytes || (ulong)bytes.LongLength != entry.Bytes || !MatchesHash(bytes, entry.Checksum))
                            throw new InvalidOperationException("asset-download-verification-failed");
                    }
                    catch { faulted = true; throw; }
                    try
                    {
                        entry.LastAccessSequence = checked(++metadata.LastAccessSequence);
                        Persist();
                    }
                    catch { faulted = true; throw; }
                    return bytes;
                }
                if (!reservations.TryGetValue(asset.Checksum, out Reservation pending)
                    || pending.Record.ExpectedBytes != asset.EncodedSizeBytes || !pending.Record.Consumers.Contains(consumerToken))
                    throw new InvalidOperationException("asset-descriptor-conflict");
                pending.Record.LeaseRenewedAtUnixMillis = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                pending.RenewedAtMonotonic = MonotonicSeconds;
                if (pending.Download == null) pending.Download = DownloadAndStoreAsync(pending, asset, download);
                sharedDownload = pending.Download;
            }
            Task cancelled = Task.Delay(Timeout.Infinite, token);
            if (await Task.WhenAny(sharedDownload, cancelled) != sharedDownload)
            {
                Release(consumerToken);
                throw new OperationCanceledException(token);
            }
            return await sharedDownload;
        }

        private async Task<byte[]> DownloadAndStoreAsync(Reservation pending, AssetAccessBinding asset,
            Func<AssetAccessBinding, CancellationToken, Task<byte[]>> download)
        {
            VerifiedEntry committedEntry = null;
            try
            {
                byte[] bytes = await download(asset, pending.Cancellation.Token);
                if (bytes == null || (ulong)bytes.LongLength != pending.Record.ExpectedBytes || !MatchesHash(bytes, asset.Checksum))
                    throw new InvalidOperationException("asset-download-verification-failed");
                lock (gate)
                {
                    if (!reservations.TryGetValue(asset.Checksum, out Reservation current) || current != pending || pending.Record.Consumers.Count == 0)
                        throw new OperationCanceledException();
                    string staging = StagingPath(asset.Checksum);
                    using (var stream = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                    pending.Record.StagingBytes = (ulong)bytes.LongLength;
                    pending.Record.RemainingBytes = 0;
                    Persist();
                    File.Move(staging, AssetPath(asset.Checksum));
                    var entry = new VerifiedEntry
                    {
                        Checksum = asset.Checksum,
                        Bytes = (ulong)bytes.LongLength,
                        LastAccessSequence = checked(++metadata.LastAccessSequence)
                    };
                    verified.Add(entry.Checksum, entry);
                    committedEntry = entry;
                    reservations.Remove(asset.Checksum);
                    Persist();
                    pending.Cancellation.Dispose();
                    return bytes;
                }
            }
            catch
            {
                lock (gate)
                {
                    bool ownsReservation = reservations.TryGetValue(asset.Checksum, out Reservation current) && current == pending;
                    bool ownsCommittedEntry = committedEntry != null
                        && verified.TryGetValue(asset.Checksum, out VerifiedEntry currentEntry) && currentEntry == committedEntry;
                    if (!disposed && (ownsReservation || ownsCommittedEntry))
                    {
                        if (ownsReservation) reservations.Remove(asset.Checksum);
                        pending.Cancellation.Dispose();
                        if (ownsCommittedEntry) verified.Remove(asset.Checksum);
                        try
                        {
                            if (File.Exists(StagingPath(asset.Checksum))) File.Delete(StagingPath(asset.Checksum));
                            if (File.Exists(AssetPath(asset.Checksum))) File.Delete(AssetPath(asset.Checksum));
                            Persist();
                        }
                        catch { faulted = true; }
                    }
                }
                throw;
            }
        }

        private void Release(string consumerToken)
        {
            lock (gate)
            {
                if (disposed) return;
                if (!sessionPins.Remove(consumerToken)) return;
                foreach (Reservation pending in reservations.Values.ToArray())
                {
                    pending.Record.Consumers.Remove(consumerToken);
                    if (pending.Record.Consumers.Count != 0) continue;
                    pending.Cancellation.Cancel();
                    reservations.Remove(pending.Record.Checksum);
                    pending.Cancellation.Dispose();
                    if (File.Exists(StagingPath(pending.Record.Checksum))) File.Delete(StagingPath(pending.Record.Checksum));
                }
                try { Persist(); }
                catch { faulted = true; }
            }
        }

        private void Sweep()
        {
            double now = MonotonicSeconds;
            if (now - lastSweepMonotonic < 300) return;
            foreach (Reservation pending in reservations.Values.ToArray())
                if (pending.Record.Consumers.Count == 0 || now - pending.RenewedAtMonotonic > 900)
                { pending.Cancellation.Cancel(); reservations.Remove(pending.Record.Checksum); pending.Cancellation.Dispose(); if (File.Exists(StagingPath(pending.Record.Checksum))) File.Delete(StagingPath(pending.Record.Checksum)); }
            lastSweepMonotonic = now;
            Persist();
        }

        private bool Fits(ulong verifiedBytes, ulong staging, ulong remaining, ulong required, ulong evicted, ulong free)
        {
            return checked(verifiedBytes - evicted + staging + remaining + required) <= hardLimitBytes
                && checked(free + evicted) >= checked(lowSpaceReserveBytes + remaining + required);
        }

        private bool Pinned(string checksum)
        {
            foreach (HashSet<string> pins in sessionPins.Values) if (pins.Contains(checksum)) return true;
            foreach (HashSet<string> pins in durablePins.Values) if (pins.Contains(checksum)) return true;
            return false;
        }

        private static bool TrySelection(string token, IReadOnlyList<AssetAccessBinding> assets,
            out HashSet<string> pins, out Dictionary<string, ulong> sizes)
        {
            pins = new HashSet<string>(StringComparer.Ordinal);
            sizes = new Dictionary<string, ulong>(StringComparer.Ordinal);
            if (string.IsNullOrWhiteSpace(token) || assets == null) return false;
            foreach (AssetAccessBinding asset in assets)
            {
                if (asset == null || !ValidChecksum(asset.Checksum) || asset.EncodedSizeBytes == 0) return false;
                if (sizes.TryGetValue(asset.Checksum, out ulong previous) && previous != asset.EncodedSizeBytes) return false;
                sizes[asset.Checksum] = asset.EncodedSizeBytes;
                pins.Add(asset.Checksum);
            }
            return true;
        }

        private static bool ValidChecksum(string checksum)
        {
            if (checksum == null || checksum.Length != 71 || !checksum.StartsWith("sha256:", StringComparison.Ordinal)) return false;
            for (int i = 7; i < checksum.Length; i++) if (checksum[i] < '0' || checksum[i] > '9' && checksum[i] < 'a' || checksum[i] > 'f') return false;
            return true;
        }

        private string AssetPath(string checksum) { return Path.Combine(directory, checksum.Substring(7) + ".bin"); }
        private string StagingPath(string checksum) { return Path.Combine(directory, checksum.Substring(7) + ".part"); }

        private bool VerifiedFile(string checksum, ulong expected)
        {
            string path = AssetPath(checksum);
            if (!File.Exists(path) || (ulong)new FileInfo(path).Length != expected) return false;
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
                return "sha256:" + BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() == checksum;
        }

        private static bool MatchesHash(byte[] bytes, string checksum)
        {
            using (var sha = SHA256.Create())
                return "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant() == checksum;
        }

        private void Persist()
        {
            metadata.Verified = verified.Values.OrderBy(entry => entry.Checksum, StringComparer.Ordinal).ToList();
            metadata.Reservations = reservations.Values.Select(item => item.Record).OrderBy(item => item.Checksum, StringComparer.Ordinal).ToList();
            string staging = Path.Combine(directory, "metadata." + Guid.NewGuid().ToString("N") + ".tmp");
            byte[] bytes = System.Text.Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(metadata));
            using (var stream = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
            if (File.Exists(metadataPath)) File.Replace(staging, metadataPath, null);
            else File.Move(staging, metadataPath);
        }

        private void SweepTimer()
        {
            lock (gate)
            {
                if (!IsReady) return;
                try
                {
                    foreach (Reservation pending in reservations.Values)
                        if (pending.Download != null && !pending.Download.IsCompleted)
                        {
                            pending.RenewedAtMonotonic = MonotonicSeconds;
                            pending.Record.LeaseRenewedAtUnixMillis = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        }
                    Persist();
                    Sweep();
                }
                catch { faulted = true; }
            }
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (disposed) return;
                disposed = true;
                sweepTimer?.Dispose();
                foreach (Reservation pending in reservations.Values)
                {
                    pending.Cancellation.Cancel();
                    pending.Cancellation.Dispose();
                    try { if (File.Exists(StagingPath(pending.Record.Checksum))) File.Delete(StagingPath(pending.Record.Checksum)); }
                    catch { faulted = true; }
                }
                reservations.Clear();
                try { Persist(); }
                catch { faulted = true; }
                directoryLock.Dispose();
            }
        }
    }
}
