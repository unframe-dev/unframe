using System;
using System.Collections;
using System.Reflection;
using System.Threading;
using NUnit.Framework;
using OpenCVForUnity.CoreModule;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class ArucoWorkerLifecycleTests
{
    private sealed class BlockingProcessor : IArucoFrameProcessor
    {
        public readonly ManualResetEventSlim Entered = new ManualResetEventSlim();
        public readonly ManualResetEventSlim Release = new ManualResetEventSlim();
        public bool Disposed;
        public bool BuffersValidAfterRelease;
        public int Calls;

        public ArucoFrameProcessingResult Process(Mat rgba, long timestamp, ArucoCameraGeometry geometry)
        {
            Calls++;
            Entered.Set();
            if (!Release.Wait(10000)) throw new TimeoutException("Worker was not released.");
            BuffersValidAfterRelease = !rgba.empty();
            return new ArucoFrameProcessingResult(new ArucoMarkerDetectionFrame(timestamp,
                new Vector2Int(rgba.cols(), rgba.rows()), new int[0], new float[0], 2), null, 1, 0);
        }

        public void Dispose() => Disposed = true;
        public void DisposeSignals() { Entered.Dispose(); Release.Dispose(); }
    }

    private static void Invoke(ArucoCameraMarkerDetection detection, string method) =>
        typeof(ArucoCameraMarkerDetection).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(detection, null);

    private static IEnumerator WaitUntil(Func<bool> condition)
    {
        double deadline = Time.realtimeSinceStartupAsDouble + 5;
        while (!condition() && Time.realtimeSinceStartupAsDouble < deadline) yield return null;
        Assert.That(condition(), Is.True, "The asynchronous stage did not complete.");
    }

    [UnityTest]
    public IEnumerator DisableDuringWorkerDropsTheOldResultAndAllowsANewResolutionAfterCompletion()
    {
        if (!SystemInfo.supportsAsyncGPUReadback) Assert.Ignore("Run with a graphics device.");
        var host = new GameObject("Worker Disable Test");
        var detection = host.AddComponent<ArucoCameraMarkerDetection>();
        var processor = new BlockingProcessor();
        var first = new Texture2D(320, 240, TextureFormat.RGBA32, false);
        var next = new Texture2D(1280, 960, TextureFormat.RGBA32, false);
        try
        {
            Invoke(detection, "Awake");
            detection.ConfigureProcessor(processor);
            var geometry = new ArucoCameraGeometry(500, 500, 160, 120, Pose.identity);
            detection.SubmitFrame(first, 1, geometry);
            yield return WaitUntil(() => processor.Entered.IsSet);
            Assert.That(detection.Phase, Is.EqualTo(ArucoDetectionPhase.Processing));
            detection.enabled = false;
            Invoke(detection, "OnDisable");
            detection.enabled = true;
            detection.SubmitFrame(next, 2, geometry);
            Assert.That(processor.Calls, Is.EqualTo(1));
            Assert.That(detection.IsProcessing, Is.True);
            Assert.That(processor.Disposed, Is.False);
            processor.Release.Set();
            yield return WaitUntil(() => !detection.IsProcessing);
            Assert.That(processor.BuffersValidAfterRelease, Is.True);
            Assert.That(detection.CurrentObservation, Is.Null);
            Assert.That(detection.Metrics.Invalidated, Is.EqualTo(1));
            detection.SubmitFrame(next, 2, geometry);
            yield return WaitUntil(() => detection.ProcessedFrames == 1);
            Assert.That(detection.CurrentFrame.Resolution, Is.EqualTo(new Vector2Int(1280, 960)));
        }
        finally
        {
            processor.Release.Set();
            Invoke(detection, "OnDestroy");
            UnityEngine.Object.DestroyImmediate(host);
            UnityEngine.Object.DestroyImmediate(first);
            UnityEngine.Object.DestroyImmediate(next);
            if (processor.Disposed) processor.DisposeSignals();
        }
    }

    [UnityTest]
    public IEnumerator DestroyDuringWorkerDefersNativeDisposalUntilTheWorkerReturns()
    {
        if (!SystemInfo.supportsAsyncGPUReadback) Assert.Ignore("Run with a graphics device.");
        var host = new GameObject("Worker Destroy Test");
        var detection = host.AddComponent<ArucoCameraMarkerDetection>();
        var processor = new BlockingProcessor();
        var texture = new Texture2D(320, 240, TextureFormat.RGBA32, false);
        try
        {
            Invoke(detection, "Awake");
            detection.ConfigureProcessor(processor);
            detection.SubmitFrame(texture, 1, new ArucoCameraGeometry(500, 500, 160, 120, Pose.identity));
            yield return WaitUntil(() => processor.Entered.IsSet);
            Invoke(detection, "OnDestroy");
            UnityEngine.Object.DestroyImmediate(host);
            Assert.That(processor.Disposed, Is.False);
            processor.Release.Set();
            yield return WaitUntil(() => processor.Disposed);
            Assert.That(processor.BuffersValidAfterRelease, Is.True);
        }
        finally
        {
            processor.Release.Set();
            if (host != null) { Invoke(detection, "OnDestroy"); UnityEngine.Object.DestroyImmediate(host); }
            UnityEngine.Object.DestroyImmediate(texture);
            if (processor.Disposed) processor.DisposeSignals();
        }
    }
    [UnityTest]
    public IEnumerator SlowWorkerIsDiscardedAndReportsTheWholeRequestDuration()
    {
        if (!SystemInfo.supportsAsyncGPUReadback) Assert.Ignore("Run with a graphics device.");
        var host = new GameObject("Worker Timeout Test");
        var detection = host.AddComponent<ArucoCameraMarkerDetection>();
        var processor = new BlockingProcessor();
        var texture = new Texture2D(320, 240, TextureFormat.RGBA32, false);
        try
        {
            Invoke(detection, "Awake");
            detection.ConfigureProcessor(processor);
            detection.SubmitFrame(texture, 1, new ArucoCameraGeometry(500, 500, 160, 120, Pose.identity));
            yield return WaitUntil(() => processor.Entered.IsSet);
            double deadline = Time.realtimeSinceStartupAsDouble + 0.6;
            while (Time.realtimeSinceStartupAsDouble < deadline) yield return null;
            processor.Release.Set();
            yield return WaitUntil(() => !detection.IsProcessing);
            Assert.That(detection.CurrentObservation, Is.Null);
            Assert.That(detection.ProcessedFrames, Is.Zero);
            Assert.That(detection.Metrics.TimedOut, Is.EqualTo(1));
            Assert.That(detection.Metrics.LastTimings.TotalMilliseconds, Is.GreaterThanOrEqualTo(500));
            Assert.That(detection.Metrics.LastTimings.PreprocessingMilliseconds, Is.EqualTo(1));
            Assert.That(detection.Metrics.LastTimings.DetectionMilliseconds, Is.EqualTo(2));
        }
        finally
        {
            processor.Release.Set();
            Invoke(detection, "OnDestroy");
            UnityEngine.Object.DestroyImmediate(host);
            UnityEngine.Object.DestroyImmediate(texture);
            if (processor.Disposed) processor.DisposeSignals();
        }
    }

}
