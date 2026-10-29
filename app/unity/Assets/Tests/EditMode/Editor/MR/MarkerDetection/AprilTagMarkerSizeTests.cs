using System;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine.UI;
using UnityEngine;

public sealed class AprilTagMarkerSizeTests
{
    [TestCase(500, 0.5)]
    [TestCase(400, 0.4)]
    [TestCase(250, 0.25)]
    [TestCase(150, 0.15)]
    public void SupportedBlackBorderSizesUseMetricDimensions(int millimeters, double meters)
    {
        var estimator = new AprilTagMarkerPoseEstimator(millimeters);
        Assert.That(estimator.MarkerSizeMeters, Is.EqualTo(meters));
    }

    [TestCase(0)]
    [TestCase(225)]
    [TestCase(300)]
    public void UnsupportedSizesAreRejected(int millimeters)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new AprilTagMarkerPoseEstimator(millimeters));
    }

    [Test]
    public void CalibrationScreenOffersAllFourSizesAndChangesTheActiveSize()
    {
        var host = new GameObject("Marker size UI test");
        var camera = new GameObject("Head", typeof(Camera));
        try
        {
            var alignment = host.AddComponent<AprilTagOriginAlignment>();
            var calibration = host.AddComponent<AprilTagPresentationCalibration>();
            calibration.Configure(alignment, host.transform);
            var view = host.AddComponent<QuestOnboardingView>();
            view.Flow.GoTo(QuestOnboardingPage.Calibration);
            view.Configure(null, null, calibration, camera.transform, null);
            foreach (int size in new[] { 500, 400, 250, 150 })
            {
                var button = view.FindButton("MarkerSize" + size);
                Assert.That(button, Is.Not.Null);
                button.onClick.Invoke();
                Assert.That(alignment.MarkerSizeMillimeters, Is.EqualTo(size));
                Assert.That(view.FindButton("MarkerSize" + size).GetComponentInChildren<Text>().text, Is.EqualTo(size + " mm"));
            }
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(host);
            UnityEngine.Object.DestroyImmediate(camera);
        }
    }

    [Test]
    public void SizeChangeResetsAlignmentAndSelectingSameSizePreservesIt()
    {
        var host = new GameObject("Marker size test");
        try
        {
            var alignment = host.AddComponent<AprilTagOriginAlignment>();
            int resets = 0;
            alignment.AlignmentInvalidated += () => resets++;
            Assert.That(alignment.MarkerSizeMillimeters, Is.EqualTo(150));
            alignment.SelectMarkerSize(500);
            Assert.That(alignment.MarkerSizeMillimeters, Is.EqualTo(500));
            Assert.That(host.GetComponent<AprilTagCameraMarkerDetection>().MarkerSizeMillimeters, Is.EqualTo(500));
            Assert.That(alignment.IsConfirmed, Is.False);
            Assert.That(resets, Is.EqualTo(1));
            alignment.SelectMarkerSize(500);
            Assert.That(resets, Is.EqualTo(1));
            Assert.Throws<ArgumentOutOfRangeException>(() => alignment.SelectMarkerSize(300));
            Assert.That(alignment.MarkerSizeMillimeters, Is.EqualTo(500));
        }
        finally { UnityEngine.Object.DestroyImmediate(host); }
    }
}
