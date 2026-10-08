using NUnit.Framework;
using System.Linq;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Presentation;
using Unframe.Delivery;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using Pose = Unframe.Presentation.Pose;
using Vector3 = UnityEngine.Vector3;
using Quaternion = UnityEngine.Quaternion;

public sealed class QuestPresentationEntryEditModeTests
{
    [Test]
    public void TrackingFrameUsesOnlyAvailableTargetsAndCanonicalQuestLocalCoordinates()
    {
        var frame = QuestPresentationTracking.CreateFrame(new Pose
        { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } },
            new QuestPoseSample(TrackedTarget.Head, new Vector3(1, 2, 3), Quaternion.identity),
            new QuestPoseSample(TrackedTarget.RightHand, new Vector3(4, 5, 6), Quaternion.identity));

        Assert.That(frame.Samples.Count, Is.EqualTo(2));
        Assert.That(frame.Samples[0].Target, Is.EqualTo(TrackedTarget.Head));
        Assert.That(frame.Samples[0].QuestLocalPose.Position.Z, Is.EqualTo(-3));
        Assert.That(frame.Samples[1].Target, Is.EqualTo(TrackedTarget.RightHand));
        Assert.That(frame.Samples[1].QuestLocalPose.Position.Z, Is.EqualTo(-6));
        Assert.That(frame.Samples.Any(sample => sample.Target == TrackedTarget.Body), Is.False);
        Assert.That(frame.PresentationFromQuestLocal.Rotation.W, Is.EqualTo(1));
    }

    [Test]
    public void UnavailableBodyIsExplicitlyClearedWithoutBorrowingHeadPose()
    {
        var frame = QuestPresentationTracking.CreateFrame(new Pose
        { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } },
            new QuestPoseSample(TrackedTarget.Head, new Vector3(1, 2, 3), Quaternion.identity),
            new QuestPoseSample(TrackedTarget.Body, new Vector3(9, 9, 9), Quaternion.identity, false));
        Assert.That(frame.Samples[1].Target, Is.EqualTo(TrackedTarget.Body));
        Assert.That(frame.Samples[1].PositionAvailable, Is.False);
        Assert.That(frame.Samples[1].RotationAvailable, Is.False);
        Assert.That(frame.Samples[1].QuestLocalPose.Position.X, Is.Zero);
        Assert.That(frame.Samples[1].QuestLocalPose.Rotation.W, Is.EqualTo(1));
    }

    [Test]
    public void LogicalInputRequiresExplicitNameAndCurrentOrigin()
    {
        Assert.Throws<System.ArgumentException>(() => QuestPresentationInput.CreateLogical("", 1));
        Assert.Throws<System.ArgumentException>(() => QuestPresentationInput.CreateLogical("advance", 0));

        var command = QuestPresentationInput.CreateLogical("advance", 7);
        Assert.That(command.ItemCase, Is.EqualTo(ControlClientItem.ItemOneofCase.LogicalInput));
        Assert.That(command.LogicalInput.LogicalEventName, Is.EqualTo("advance"));
        Assert.That(command.LogicalInput.PresentationOriginVersion, Is.EqualTo(7));
        Assert.That(command.LogicalInput.ClientEventId, Is.Not.Empty);
        var surface = QuestPresentationInput.CreateSurfaceInteraction("surface", "button", 8);
        Assert.That(surface.ItemCase, Is.EqualTo(ControlClientItem.ItemOneofCase.SurfaceInteraction));
        Assert.That(surface.SurfaceInteraction.SurfaceId, Is.EqualTo("surface"));
        Assert.That(surface.SurfaceInteraction.InteractionId, Is.EqualTo("button"));
        Assert.That(surface.SurfaceInteraction.PresentationOriginVersion, Is.EqualTo(8));
        Assert.That(surface.SurfaceInteraction.ClientEventId, Is.Not.EqualTo(command.LogicalInput.ClientEventId));
    }

    [Test]
    public void ButtonsRequireANewPressAfterReadinessAndNeverRepeatWhileHeld()
    {
        var edges = new QuestPresentationButtonEdges();
        edges.Sample(false, true, true, false, out bool left, out bool right, out bool logical);
        Assert.That(left || right || logical, Is.False);
        edges.Sample(false, true, true, true, out left, out right, out logical);
        Assert.That(left || right || logical, Is.False);
        edges.Sample(false, false, false, true, out left, out right, out logical);
        edges.Sample(false, true, true, true, out left, out right, out logical);
        Assert.That(left, Is.False);
        Assert.That(right && logical, Is.True);
        edges.Sample(false, true, true, true, out left, out right, out logical);
        Assert.That(left || right || logical, Is.False);
    }

    [Test]
    public void RayPickingUsesFrontFaceAndCurrentStateRegions()
    {
        GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
        try
        {
            LogicalBounds partition = new LogicalBounds { X = 50, Y = 0, Width = 50, Height = 100 };
            Assert.That(QuestPresentationSurfacePicking.TryIntersect(new Ray(new Vector3(0, 0, -1), Vector3.forward),
                quad.transform, partition, 100, 100, out QuestNormalizedPoint point, out _), Is.True);
            Assert.That(point.X, Is.EqualTo(0.75));
            Assert.That(point.Y, Is.EqualTo(0.5));
            Assert.That(QuestPresentationSurfacePicking.TryIntersect(new Ray(new Vector3(0, 0, 1), Vector3.back),
                quad.transform, partition, 100, 100, out _, out _), Is.False);
            Assert.That(QuestPresentationSurfacePicking.TryIntersect(new Ray(new Vector3(0, 0, -20), Vector3.forward),
                quad.transform, partition, 100, 100, out _, out _), Is.True);
            Assert.That(QuestPresentationSurfacePicking.TryIntersect(new Ray(new Vector3(0, 0, -1), Vector3.forward),
                quad.transform, partition, double.NaN, 100, out _, out _), Is.False);

            var surface = new ProjectedSemanticSurface { SemanticSurfaceId = "surface" };
            var state = new SurfaceSemanticState { StateId = "open" };
            state.InteractiveRegions.Add(new InteractiveRegion
            {
                InteractionId = "lower",
                SemanticNodeId = "button-a",
                Priority = 1,
                NormalizedBounds = new LogicalBounds { X = 0.5, Y = 0.25, Width = 0.5, Height = 0.5 },
            });
            state.InteractiveRegions.Add(new InteractiveRegion
            {
                InteractionId = "higher",
                SemanticNodeId = "button-b",
                Priority = 2,
                NormalizedBounds = new LogicalBounds { X = 0.5, Y = 0.25, Width = 0.5, Height = 0.5 },
            });
            surface.States.Add(state);
            Assert.That(QuestPresentationSurfacePicking.TryResolve(surface, "open", point, out string interaction), Is.True);
            Assert.That(interaction, Is.EqualTo("higher"));
            Assert.That(QuestPresentationSurfacePicking.TryResolve(surface, "closed", point, out _), Is.False);
            Assert.That(QuestPresentationSurfacePicking.TryResolve(surface, "open", new QuestNormalizedPoint(1, 0.5), out _), Is.False);
            Assert.That(QuestPresentationSurfacePicking.TryResolve(surface, "open", new QuestNormalizedPoint(double.NaN, 0.5), out _), Is.False);
        }
        finally { UnityEngine.Object.DestroyImmediate(quad); }
    }

    [Test]
    public void QuestSceneWiresRuntimeAndBodyWithoutReplacingTheLocalFixtureScene()
    {
        Scene scene = EditorSceneManager.OpenScene("Assets/Scenes/QuestPresentationScene.unity", OpenSceneMode.Additive);
        try
        {
            QuestPresentationEntry entry = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<QuestPresentationEntry>(true)).Single();
            Assert.That(entry.GetComponent<PresentationBakedRuntime>(), Is.Not.Null);
            Assert.That(entry.GetComponent<QuestBodyTrackingSource>(), Is.Not.Null);
            SerializedObject serialized = new SerializedObject(entry);
            Assert.That(serialized.FindProperty("runtime").objectReferenceValue, Is.SameAs(entry.GetComponent<PresentationBakedRuntime>()));
            Assert.That(serialized.FindProperty("questTrackingOrigin").objectReferenceValue, Is.Not.Null);
            Assert.That(scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<LocalPresentationFixtureRunner>(true)), Is.Empty);
        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }

    [Test]
    public void NetworkSceneHasOneCameraRigAndSharesMarkerCalibrationWithTheSession()
    {
        var scene = EditorSceneManager.OpenScene("Assets/Scenes/QuestPresentationScene.unity", OpenSceneMode.Additive);
        try
        {
            var roots = scene.GetRootGameObjects();
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<OVRCameraRig>(true)).Count(), Is.EqualTo(1));
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<Unity.XR.CoreUtils.XROrigin>(true)), Is.Empty);
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Count(), Is.EqualTo(1));
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<ArucoPresentationCalibration>(true)).Count(), Is.EqualTo(1));
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<QuestPresentationStatusView>(true)).Count(), Is.EqualTo(1));
            var rig = roots.SelectMany(root => root.GetComponentsInChildren<OVRCameraRig>(true)).Single();
            var entry = roots.SelectMany(root => root.GetComponentsInChildren<QuestPresentationEntry>(true)).Single();
            var source = roots.SelectMany(root => root.GetComponentsInChildren<ArucoPresentationCalibration>(true)).Single();
            var session = roots.SelectMany(root => root.GetComponentsInChildren<QuestPresentationSession>(true)).Single();
            Assert.That(entry.QuestTrackingOrigin, Is.SameAs(rig.trackingSpace));
            Assert.That(source.QuestTrackingOrigin, Is.SameAs(rig.trackingSpace));
            var sessionSettings = new SerializedObject(session);
            Assert.That(sessionSettings.FindProperty("entry").objectReferenceValue, Is.SameAs(entry));
            Assert.That(sessionSettings.FindProperty("calibrationSource").objectReferenceValue, Is.SameAs(source));
            var view = roots.SelectMany(root => root.GetComponentsInChildren<QuestPresentationStatusView>(true)).Single();
            var viewSettings = new SerializedObject(view);
            Assert.That(viewSettings.FindProperty("head").objectReferenceValue, Is.SameAs(rig.centerEyeAnchor));
            Assert.That(viewSettings.FindProperty("calibrationSource").objectReferenceValue, Is.SameAs(source));
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<UnityEngine.Canvas>(true)), Is.Empty, "Runtime UI must not be baked into the generated scene.");

        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }

    [Test]
    public void AndroidOpenXrProviderLoadsAndRunsAutomatically()
    {
        string settings = File.ReadAllText(Path.Combine(Application.dataPath, "XR", "XRGeneralSettingsPerBuildTarget.asset"));
        Assert.That(Regex.IsMatch(settings,
            @"m_Name: Android Providers\s+.*?m_AutomaticLoading: 1\s+m_AutomaticRunning: 1\s+m_Loaders:\s+- \{fileID: 11400000, guid: cd94d1117251d468a810a25c1fa27815, type: 2\}",
            RegexOptions.Singleline), Is.True);
    }

    [Test]
    public async Task PauseAndDisableRequireExplicitRecalibrationWithoutLosingTheSessionState()
    {
        GameObject host = new GameObject("Quest calibration lifecycle");
        try
        {
            var entry = host.AddComponent<QuestPresentationEntry>();
            var settings = new SerializedObject(entry);
            settings.FindProperty("questTrackingOrigin").objectReferenceValue = host.transform;
            settings.ApplyModifiedPropertiesWithoutUndo();
            var state = new PresentationCalibrationState();
            async Task<string> WaitForCredential(CancellationToken token)
            {
                await Task.Delay(Timeout.Infinite, token);
                return "never-used";
            }
            entry.Configure(new System.Uri("https://api.example.com/"), "session", WaitForCredential, state, null);
            StringAssert.Contains("Calibration required", entry.Summary);
            var pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity);
            Assert.That(state.TrySet(pose, out _), Is.True);
            Assert.That(entry.Calibration, Is.SameAs(state));
            typeof(QuestPresentationEntry).GetMethod("OnApplicationPause", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(entry, new object[] { true });
            Assert.That(state.IsValid, Is.False);
            Assert.That(state.Reason, Is.EqualTo("application-paused"));
            typeof(QuestPresentationEntry).GetMethod("OnApplicationPause", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(entry, new object[] { false });
            Assert.That(state.IsValid, Is.False);
            Assert.That(state.TrySet(pose, out _), Is.True);
            entry.InvalidateCalibration("tracking-origin-changed");
            Assert.That(state.IsValid, Is.False);
            Assert.That(state.TrySet(pose, out _), Is.True);
            typeof(QuestPresentationEntry).GetMethod("OnDisable", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(entry, null);
            Assert.That(state.IsValid, Is.False);
            Assert.That(state.Reason, Is.EqualTo("entry-disabled"));
            await entry.StopAsync();
        }
        finally { UnityEngine.Object.DestroyImmediate(host); }
    }

    [Test]
    public async Task HeadTrackingLossInvalidatesCalibrationAndCancelsQueuedInteractions()
    {
        await AssertTrackingNotificationInvalidates("OnTrackingLost", new UnityEngine.XR.XRNodeState
        { nodeType = UnityEngine.XR.XRNode.Head }, "head-tracking-lost");
    }

    [Test]
    public async Task TrackingOriginChangeInvalidatesCalibrationAndCancelsQueuedInteractions()
    {
        await AssertTrackingNotificationInvalidates("OnTrackingOriginUpdated", null, "tracking-origin-changed");
    }

    private static async Task AssertTrackingNotificationInvalidates(string method, object notification, string reason)
    {
        var host = new GameObject("Quest tracking notification");
        QuestPresentationEntry entry = null;
        try
        {
            entry = host.AddComponent<QuestPresentationEntry>();
            var settings = new SerializedObject(entry);
            settings.FindProperty("questTrackingOrigin").objectReferenceValue = host.transform;
            settings.ApplyModifiedPropertiesWithoutUndo();
            var calibration = new PresentationCalibrationState();
            var pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity);
            Assert.That(calibration.TrySet(pose, out _), Is.True);
            async Task<string> WaitForCredential(CancellationToken token)
            {
                await Task.Delay(Timeout.Infinite, token);
                return "never-used";
            }
            entry.Configure(new System.Uri("https://api.example.com/"), "session", WaitForCredential, calibration, null);
            var field = typeof(QuestPresentationEntry).GetField("interactionLifetime", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            CancellationToken before = ((CancellationTokenSource)field.GetValue(entry)).Token;
            Assert.That(before.IsCancellationRequested, Is.False);
            typeof(QuestPresentationEntry).GetMethod(method, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(entry, new[] { notification });
            Assert.That(calibration.IsValid, Is.False);
            Assert.That(calibration.Reason, Is.EqualTo(reason));
            Assert.That(before.IsCancellationRequested, Is.True);
            Assert.That(entry.GetComponent<PresentationBakedRuntime>().PresentationSpace.gameObject.activeSelf, Is.False);
            Assert.That(calibration.TrySet(pose, out _), Is.True);
            CancellationToken after = ((CancellationTokenSource)field.GetValue(entry)).Token;
            Assert.That(after.IsCancellationRequested, Is.False);
            Assert.That(after, Is.Not.EqualTo(before));
        }
        finally
        {
            if (entry != null) await entry.StopAsync();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    [Test]
    public async Task StoppingCancelsTheCredentialWaitAndAllowsAnewRun()
    {
        GameObject host = new GameObject("Quest entry lifecycle");
        try
        {
            host.AddComponent<PresentationBakedRuntime>();
            QuestPresentationEntry entry = host.AddComponent<QuestPresentationEntry>();
            var entrySettings = new SerializedObject(entry);
            entrySettings.FindProperty("questTrackingOrigin").objectReferenceValue = host.transform;
            entrySettings.ApplyModifiedPropertiesWithoutUndo();
            var calibration = new PresentationCalibrationState();
            Assert.That(calibration.TrySet(new Pose
            { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } }, out _), Is.True);
            async Task<string> WaitForCredential(CancellationToken token)
            {
                await Task.Delay(Timeout.Infinite, token);
                return "never-used";
            }
            entry.Configure(new System.Uri("https://api.example.com/"), "session", WaitForCredential, calibration, null);
            Task firstStop = entry.StopAsync();
            Assert.That(await Task.WhenAny(firstStop, Task.Delay(5000)), Is.SameAs(firstStop));
            await firstStop;
            entry.Configure(new System.Uri("https://api.example.com/"), "session", WaitForCredential, calibration, null);
            Task secondStop = entry.StopAsync();
            Assert.That(await Task.WhenAny(secondStop, Task.Delay(5000)), Is.SameAs(secondStop));
            await secondStop;
        }
        finally { UnityEngine.Object.DestroyImmediate(host); }
    }
}
