using System.IO;
using NUnit.Framework;
using UnityEngine;

public sealed class ArucoTrackingDiagnosticsEditModeTests
{
    [Test]
    public void WritesSessionAndStructuredTrackingEventsAsJsonLines()
    {
        string directory = Path.Combine(
            Path.GetTempPath(),
            "unframe-aruco-diagnostics-" + System.Guid.NewGuid().ToString("N")
        );

        try
        {
            ArucoTrackingDiagnostics diagnostics = new ArucoTrackingDiagnostics(directory);
            string path = diagnostics.FilePath;
            string sessionId = diagnostics.SessionId;

            diagnostics.Record(
                new ArucoTrackingDiagnosticEvent
                {
                    eventType = "marker_pose",
                    cameraWidth = 640,
                    cameraHeight = 640,
                    captureTimestampSeconds = 12.3456789,
                    cameraFx = 580f,
                    cameraFy = 581f,
                    cameraCx = 320f,
                    cameraCy = 320f,
                    cameraDistortionCoefficients = new[] { 0.01f, -0.02f, 0f, 0f, 0.001f },
                    detectedMarkerCount = 1,
                    markerIds = new[] { 17 },
                    poseValid = true,
                    cameraFromMarkerPositionMeters = new[] { 0.1f, 0.2f, 0.8f },
                    cameraFromMarkerRotationXyzw = new[] { 0f, 0f, 0f, 1f },
                    hasReprojectionError = true,
                    reprojectionErrorPixels = 0.75f,
                    trackingAvailable = true,
                    presentationFromQuestLocalPositionMeters = new[] { 1f, 2f, 3f },
                    presentationFromQuestLocalRotationXyzw = new[] { 0f, 0f, 0f, 1f }
                }
            );
            diagnostics.Dispose();

            string[] lines = File.ReadAllLines(path);
            Assert.That(lines, Has.Length.EqualTo(3));

            ArucoTrackingDiagnosticEvent sessionStart = JsonUtility.FromJson<ArucoTrackingDiagnosticEvent>(lines[0]);
            ArucoTrackingDiagnosticEvent markerPose = JsonUtility.FromJson<ArucoTrackingDiagnosticEvent>(lines[1]);
            ArucoTrackingDiagnosticEvent sessionEnd = JsonUtility.FromJson<ArucoTrackingDiagnosticEvent>(lines[2]);

            Assert.That(sessionStart.eventType, Is.EqualTo("session_start"));
            Assert.That(sessionStart.sessionId, Is.EqualTo(sessionId));
            Assert.That(markerPose.eventType, Is.EqualTo("marker_pose"));
            Assert.That(markerPose.sequence, Is.GreaterThan(sessionStart.sequence));
            Assert.That(markerPose.markerIds, Is.EqualTo(new[] { 17 }));
            Assert.That(markerPose.captureTimestampSeconds, Is.EqualTo(12.3456789));
            Assert.That(markerPose.cameraFx, Is.EqualTo(580f));
            Assert.That(markerPose.cameraDistortionCoefficients, Is.EqualTo(new[] { 0.01f, -0.02f, 0f, 0f, 0.001f }));
            Assert.That(markerPose.cameraFromMarkerPositionMeters, Is.EqualTo(new[] { 0.1f, 0.2f, 0.8f }));
            Assert.That(markerPose.deviceModel, Is.Not.Empty);
            Assert.That(sessionEnd.eventType, Is.EqualTo("session_end"));
            Assert.That(sessionEnd.sequence, Is.GreaterThan(markerPose.sequence));
        }
        finally
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }
        }
    }
}
