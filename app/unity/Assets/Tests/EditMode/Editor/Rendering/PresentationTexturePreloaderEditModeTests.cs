using System;
using System.Collections;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationTexturePreloaderEditModeTests
{
    [UnityTest]
    public IEnumerator AdvancingReleasesCompletedTexturesAndWarmsAnotherGroupWithinBudget()
    {
        var first = PresentationTextureResidencyEditModeTests.Binding("first");
        var second = first.Clone(); second.AssetId = "second"; second.Checksum = "sha256:" + new string('b', 64);
        var third = first.Clone(); third.AssetId = "third"; third.Checksum = "sha256:" + new string('c', 64);
        var plan = new TextureResidencyPlan
        {
            InitialGroupId = "z-first",
            Textures = { first, second, third },
            GroupWindows = {
            new TextureResidencyWindow { GroupId = "a-second", AssetIds = { "second" } },
            new TextureResidencyWindow { GroupId = "m-third", AssetIds = { "third" } },
            new TextureResidencyWindow { GroupId = "z-first", AssetIds = { "first" } },
        }
        };
        using (var textures = new PresentationTextureResidency())
        using (var preloader = new PresentationTexturePreloader(plan, textures, (_, __) => Task.FromResult(new byte[] { 255, 0, 0, 255 })))
        {
            byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            Assert.That(textures.TryLoad(first, PresentationTextureResidencyEditModeTests.Access("first"), png, out _), Is.True);
            textures.TryGet(first.Checksum, out Texture2D old);
            preloader.Activate("z-first");
            var limits = new TextureLimits { MaxGpuBytes = 8, MaxTextureBindings = 2, MaxSerialLoadCpuBytes = 94 };
            Task warm = preloader.WarmNextAsync(limits, 0, 0, 0);
            while (!warm.IsCompleted) yield return null;
            warm.GetAwaiter().GetResult();
            Assert.That(textures.TryGet(second.Checksum, out _), Is.True);
            Assert.That(textures.TryGet(third.Checksum, out _), Is.False);
            preloader.Activate("a-second");
            Assert.That(old == null, Is.True);
            warm = preloader.WarmNextAsync(limits, 0, 0, 0);
            while (!warm.IsCompleted) yield return null;
            warm.GetAwaiter().GetResult();
            Assert.That(textures.TryGet(third.Checksum, out _), Is.True);
            Assert.That(textures.ResidentGpuBytes, Is.EqualTo(8));
        }
    }

    [UnityTest]
    public IEnumerator PurePreparationRunsOffTheUnityThreadAndHonorsCancellation()
    {
        byte[] png = PngVariant(180, out TextureResidencyBinding binding, out AssetAccessBinding access);
        Task<byte[]> preparation = Task.Run(() =>
        {
            Assert.That(PresentationTextureResidency.TryPrepare(binding, access, png, out byte[] rgba), Is.True);
            return rgba;
        });
        while (!preparation.IsCompleted) yield return null;
        CollectionAssert.AreEqual(new byte[] { 180, 0, 0, 255 }, preparation.GetAwaiter().GetResult());
        using (var cancelled = new CancellationTokenSource())
        {
            cancelled.Cancel();
            Assert.Throws<OperationCanceledException>(() => PresentationTextureResidency.TryPrepare(binding, access, png, out _, cancelled.Token));
        }
    }

    [UnityTest]
    public IEnumerator CancelledPreparationIsDrainedWithoutUploadingItsLateResult()
    {
        var first = PresentationTextureResidencyEditModeTests.Binding("first");
        var next = first.Clone(); next.AssetId = "next"; next.Checksum = "sha256:" + new string('b', 64);
        var plan = new TextureResidencyPlan
        {
            InitialGroupId = "first",
            Textures = { first, next },
            GroupWindows = {
            new TextureResidencyWindow { GroupId = "first", AssetIds = { "first" } },
            new TextureResidencyWindow { GroupId = "next", AssetIds = { "next" } },
        }
        };
        var prepared = new TaskCompletionSource<byte[]>();
        CancellationToken signal = default;
        using (var textures = new PresentationTextureResidency())
        using (var preloader = new PresentationTexturePreloader(plan, textures, (_, token) => { signal = token; return prepared.Task; }))
        {
            byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            Assert.That(textures.TryLoad(first, PresentationTextureResidencyEditModeTests.Access("first"), png, out _), Is.True);
            preloader.Activate("first");
            var limits = new TextureLimits { MaxGpuBytes = 8, MaxTextureBindings = 2, MaxSerialLoadCpuBytes = 94 };
            Task warm = preloader.WarmNextAsync(limits, 0, 0, 0);
            while (!signal.CanBeCanceled) yield return null;
            Assert.That(preloader.PrepareForeground("next", new[] { next }, limits, 0, 0), Is.False);
            Assert.That(signal.IsCancellationRequested, Is.True);
            Task drain = preloader.StopAsync();
            Assert.That(drain.IsCompleted, Is.False);
            prepared.SetResult(new byte[] { 255, 0, 0, 255 });
            while (!drain.IsCompleted) yield return null;
            drain.GetAwaiter().GetResult();
            Assert.Throws<ObjectDisposedException>(() => preloader.Activate("next"));
            Assert.That(textures.TryGet(next.Checksum, out _), Is.False);
            Assert.That(textures.TryGet(first.Checksum, out _), Is.True);
        }
    }

    [TestCase(4ul, 0ul, 0ul)]
    [TestCase(0ul, 1ul, 0ul)]
    [TestCase(0ul, 0ul, 1ul)]
    public void OtherMediaReservationsPreventSpeculativeBudgetOvercommit(ulong gpu, ulong bindings, ulong cpu)
    {
        var first = PresentationTextureResidencyEditModeTests.Binding("first");
        var next = first.Clone(); next.AssetId = "next"; next.Checksum = "sha256:" + new string('b', 64);
        var plan = new TextureResidencyPlan
        {
            InitialGroupId = "first",
            Textures = { first, next },
            GroupWindows = {
            new TextureResidencyWindow { GroupId = "first", AssetIds = { "first" } },
            new TextureResidencyWindow { GroupId = "next", AssetIds = { "next" } },
        }
        };
        using (var textures = new PresentationTextureResidency())
        using (var preloader = new PresentationTexturePreloader(plan, textures, (_, __) => throw new AssertionException("No spare budget")))
        {
            byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            Assert.That(textures.TryLoad(first, PresentationTextureResidencyEditModeTests.Access("first"), png, out _), Is.True);
            preloader.Activate("first");
            Assert.That(preloader.WarmNextAsync(new TextureLimits { MaxGpuBytes = 8, MaxTextureBindings = 2, MaxSerialLoadCpuBytes = 94 }, gpu, bindings, cpu).IsCompleted, Is.True);
            Assert.That(textures.ResidentGpuBytes, Is.EqualTo(4));
        }
    }

    [UnityTest]
    public IEnumerator FailedSpeculationKeepsTheCurrentTextureAndDoesNotCompleteItsGroup()
    {
        var first = PresentationTextureResidencyEditModeTests.Binding("first");
        var next = first.Clone(); next.AssetId = "next"; next.Checksum = "sha256:" + new string('b', 64);
        var plan = new TextureResidencyPlan
        {
            InitialGroupId = "first",
            Textures = { first, next },
            GroupWindows = {
            new TextureResidencyWindow { GroupId = "first", AssetIds = { "first" } },
            new TextureResidencyWindow { GroupId = "next", AssetIds = { "next" } },
        }
        };
        using (var textures = new PresentationTextureResidency())
        using (var preloader = new PresentationTexturePreloader(plan, textures, (_, __) => Task.FromException<byte[]>(new System.IO.IOException("unavailable"))))
        {
            byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            Assert.That(textures.TryLoad(first, PresentationTextureResidencyEditModeTests.Access("first"), png, out _), Is.True);
            preloader.Activate("first");
            var limits = new TextureLimits { MaxGpuBytes = 8, MaxTextureBindings = 2, MaxSerialLoadCpuBytes = 94 };
            Task warm = preloader.WarmNextAsync(limits, 0, 0, 0);
            while (!warm.IsCompleted) yield return null;
            warm.GetAwaiter().GetResult();
            Assert.Throws<InvalidOperationException>(() => PresentationTextureWindow.Prepare(textures, new[] { next }, limits, 0, 0, () => Assert.Fail("No detach is needed"), _ => false));
            Assert.That(textures.TryGet(first.Checksum, out _), Is.True);
            Assert.That(textures.TryGet(next.Checksum, out _), Is.False);
        }
    }

    [UnityTest]
    public IEnumerator ACompletedGroupTextureRemainsResidentWhenAnUnvisitedGroupSharesIt()
    {
        var first = PresentationTextureResidencyEditModeTests.Binding("first");
        var next = first.Clone(); next.AssetId = "next"; next.Checksum = "sha256:" + new string('b', 64);
        var plan = new TextureResidencyPlan
        {
            InitialGroupId = "z-first",
            Textures = { first, next },
            GroupWindows = {
            new TextureResidencyWindow { GroupId = "a-next", AssetIds = { "next" } },
            new TextureResidencyWindow { GroupId = "m-shared", AssetIds = { "first" } },
            new TextureResidencyWindow { GroupId = "z-first", AssetIds = { "first" } },
        }
        };
        using (var textures = new PresentationTextureResidency())
        using (var preloader = new PresentationTexturePreloader(plan, textures, (_, __) => Task.FromResult(new byte[] { 255, 0, 0, 255 })))
        {
            byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            Assert.That(textures.TryLoad(first, PresentationTextureResidencyEditModeTests.Access("first"), png, out _), Is.True);
            textures.TryGet(first.Checksum, out Texture2D original);
            preloader.Activate("z-first");
            Task warm = preloader.WarmNextAsync(new TextureLimits { MaxGpuBytes = 8, MaxTextureBindings = 2, MaxSerialLoadCpuBytes = 94 }, 0, 0, 0);
            while (!warm.IsCompleted) yield return null;
            warm.GetAwaiter().GetResult();
            preloader.Activate("a-next");
            Assert.That(textures.TryGet(first.Checksum, out Texture2D shared), Is.True);
            Assert.That(shared, Is.SameAs(original));
            Assert.That(textures.ResidentGpuBytes, Is.EqualTo(8));
        }
    }

    [UnityTest]
    public IEnumerator ForegroundEvictsWarmTexturesForOtherMediaGpuBytes() => ForegroundEviction(4, 0);

    [UnityTest]
    public IEnumerator ForegroundEvictsWarmTexturesForOtherMediaBindings() => ForegroundEviction(0, 1);

    private static IEnumerator ForegroundEviction(ulong residentGpu, ulong residentBindings)
    {
        var first = PresentationTextureResidencyEditModeTests.Binding("first");
        var warmBinding = first.Clone(); warmBinding.AssetId = "warm"; warmBinding.Checksum = "sha256:" + new string('b', 64);
        byte[] requiredPng = PngVariant(190, out var required, out var access);
        var plan = new TextureResidencyPlan
        {
            InitialGroupId = "first",
            Textures = { first, warmBinding, required },
            GroupWindows = {
            new TextureResidencyWindow { GroupId = "first", AssetIds = { "first" } },
            new TextureResidencyWindow { GroupId = "warm", AssetIds = { "warm" } },
            new TextureResidencyWindow { GroupId = "required", AssetIds = { required.AssetId } },
        }
        };
        using (var textures = new PresentationTextureResidency())
        using (var preloader = new PresentationTexturePreloader(plan, textures, (_, __) => Task.FromResult(new byte[] { 255, 0, 0, 255 })))
        {
            byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            Assert.That(textures.TryLoad(first, PresentationTextureResidencyEditModeTests.Access("first"), png, out _), Is.True);
            preloader.Activate("first");
            var limits = new TextureLimits { MaxGpuBytes = 12, MaxTextureBindings = 3, MaxSerialLoadCpuBytes = 94 };
            Task warm = preloader.WarmNextAsync(limits, 0, 0, 0);
            while (!warm.IsCompleted) yield return null;
            warm.GetAwaiter().GetResult();
            Assert.That(textures.TryGet(warmBinding.Checksum, out _), Is.True);
            Assert.That(preloader.PrepareForeground("required", new[] { required }, limits, residentGpu, residentBindings), Is.True);
            Assert.That(textures.TryGet(warmBinding.Checksum, out _), Is.False);
            Assert.That(PresentationTextureWindow.Prepare(textures, new[] { required }, limits, residentGpu, residentBindings,
                () => Assert.Fail("The current display must fit after evicting speculative textures"),
                binding => textures.TryLoad(binding, access, requiredPng, out _)), Is.True);
            Assert.That(textures.TryGet(first.Checksum, out _), Is.True);
            Assert.That(textures.TryGet(required.Checksum, out _), Is.True);
            Assert.That(textures.ResidentGpuBytes, Is.EqualTo(8));
        }
    }

    internal static byte[] PngVariant(byte red, out TextureResidencyBinding binding, out AssetAccessBinding access)
    {
        byte[] png = (byte[])((byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null)).Clone();
        png[62] = red;
        uint a = 1, b = 0;
        for (int i = 61; i < 66; i++) { a = (a + png[i]) % 65521; b = (b + a) % 65521; }
        WriteUInt(png, 66, b << 16 | a);
        uint crc = uint.MaxValue;
        for (int i = 50; i < 70; i++)
        {
            crc ^= png[i];
            for (int bit = 0; bit < 8; bit++) crc = (crc & 1) != 0 ? 0xedb88320U ^ crc >> 1 : crc >> 1;
        }
        WriteUInt(png, 70, ~crc);
        using (var hash = System.Security.Cryptography.SHA256.Create())
        {
            binding = PresentationTextureResidencyEditModeTests.Binding("asset:next");
            binding.Checksum = "sha256:" + BitConverter.ToString(hash.ComputeHash(png)).Replace("-", "").ToLowerInvariant();
            access = PresentationTextureResidencyEditModeTests.Access("asset:next"); access.Checksum = binding.Checksum;
        }
        return png;
    }

    private static void WriteUInt(byte[] bytes, int offset, uint value)
    { bytes[offset] = (byte)(value >> 24); bytes[offset + 1] = (byte)(value >> 16); bytes[offset + 2] = (byte)(value >> 8); bytes[offset + 3] = (byte)value; }
}
