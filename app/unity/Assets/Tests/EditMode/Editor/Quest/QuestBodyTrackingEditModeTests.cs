using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Xml;
using NUnit.Framework;
using Unframe.Unity.Editor;
using Unframe.Unity.PresentationRuntime;
using Unity.XR.Management.AndroidManifest.Editor;
using UnityEngine;
using UnityEngine.XR.OpenXR;
using UnityEditor;
using UnityEditor.XR.Management;

public sealed class QuestBodyTrackingEditModeTests
{
    private static readonly Type FeatureType = typeof(QuestBodyTrackingFeature);

    [Test]
    public void OpenXrBodyAbiMatchesDefaultJointSetAndRequiredNativeOffsets()
    {
        Assert.That(Constant("JointCount"), Is.EqualTo(70));
        Assert.That(Constant("HipsJoint"), Is.EqualTo(1));
        Assert.That(Marshal.SizeOf(Native("BodyJointLocation")), Is.EqualTo(40));
        Assert.That(Marshal.OffsetOf(Native("BodyJointLocation"), "Pose").ToInt32(), Is.EqualTo(8));
        Assert.That(Marshal.SizeOf(Native("BodyJointLocations")), Is.EqualTo(56));
        Assert.That(Marshal.OffsetOf(Native("BodyJointLocations"), "JointLocations").ToInt32(), Is.EqualTo(32));
        Assert.That(Marshal.OffsetOf(Native("BodyJointLocations"), "Time").ToInt32(), Is.EqualTo(48));
        Assert.That(Marshal.SizeOf(Native("SystemProperties")), Is.EqualTo(304));
        Assert.That(Marshal.OffsetOf(Native("SystemProperties"), "SystemName").ToInt32(), Is.EqualTo(28));
        Assert.That(Marshal.SizeOf(Native("SystemBodyTrackingProperties")), Is.EqualTo(24));
        Assert.That(Marshal.SizeOf(Native("FrameState")), Is.EqualTo(40));
        Assert.That(Marshal.OffsetOf(Native("FrameState"), "PredictedDisplayTime").ToInt32(), Is.EqualTo(16));
        Assert.That(Native("GetInstanceProcAddrDelegate").GetCustomAttribute<UnmanagedFunctionPointerAttribute>().CallingConvention,
            Is.EqualTo(CallingConvention.Cdecl));
        Assert.That(Native("WaitFrameDelegate").GetCustomAttribute<UnmanagedFunctionPointerAttribute>().CallingConvention,
            Is.EqualTo(CallingConvention.Cdecl));
        Assert.That(FeatureType.GetMethod("HookedWaitFrame", BindingFlags.NonPublic | BindingFlags.Static)
            .GetCustomAttribute<AOT.MonoPInvokeCallbackAttribute>(), Is.Not.Null);
    }

    [Test]
    public void HipPoseRequiresBothValidFlagsAndUsesUnityCoordinates()
    {
        Assert.That(ConvertHip(15, 1f, 2f, 3f, out Vector3 position, out Quaternion rotation), Is.True);
        Assert.That(position, Is.EqualTo(new Vector3(1f, 2f, -3f)));
        Assert.That(rotation, Is.EqualTo(new Quaternion(-0.1f, -0.2f, 0.3f, 0.9f)));
        Assert.That(ConvertHip(3, 1f, 2f, 3f, out _, out _), Is.True);
        Assert.That(ConvertHip(1, 1f, 2f, 3f, out _, out _), Is.False);
        Assert.That(ConvertHip(2, 1f, 2f, 3f, out _, out _), Is.False);
        Assert.That(ConvertHip(0, 1f, 2f, 3f, out _, out _), Is.False);
        Assert.That(ConvertHip(15, float.NaN, 2f, 3f, out _, out _), Is.False);
    }

    [Test]
    public void InactiveFeatureNeverReturnsAStaleBodyPose()
    {
        var feature = ScriptableObject.CreateInstance<QuestBodyTrackingFeature>();
        try
        {
            feature.enabled = true;
            SetField(feature, "supported", true);
            SetField(feature, "sessionRunning", true);
            SetField(feature, "tracker", 1UL);
            SetField(feature, "predictedDisplayTime", 0L);
            Assert.That(feature.TryGetHipPose(out _, out _), Is.False);

            SetField(feature, "predictedDisplayTime", 42L);
            MethodInfo end = FeatureType.GetMethod("OnSessionEnd", BindingFlags.NonPublic | BindingFlags.Instance);
            end.Invoke(feature, new object[] { 1UL });
            Assert.That((long)GetField(feature, "predictedDisplayTime"), Is.Zero);
            Assert.That((bool)GetField(feature, "sessionRunning"), Is.False);

            SetField(feature, "predictedDisplayTime", 55L);
            FeatureType.GetMethod("OnAppSpaceChange", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(feature, new object[] { 0UL });
            Assert.That((long)GetField(feature, "predictedDisplayTime"), Is.Zero);

            SetField(feature, "sessionRunning", true);
            SetField(feature, "predictedDisplayTime", 77L);
            FeatureType.GetMethod("OnSessionLossPending", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(feature, new object[] { 1UL });
            Assert.That((long)GetField(feature, "predictedDisplayTime"), Is.Zero);
            Assert.That((bool)GetField(feature, "sessionRunning"), Is.False);
        }
        finally { UnityEngine.Object.DestroyImmediate(feature); }
    }

    [Test]
    public void EditorWithoutAnActiveQuestBodyTrackerReportsUnavailable()
    {
        var gameObject = new GameObject("body-source-test");
        try
        {
            var source = gameObject.AddComponent<QuestBodyTrackingSource>();
            Assert.That(source.TryGetQuestLocalPose(out _, out _), Is.False);
        }
        finally { UnityEngine.Object.DestroyImmediate(gameObject); }
    }

    [Test]
    public void AndroidBuildProviderDeclaresOptionalBodyFeaturesAndInstallTimePermission()
    {
        Assert.That(OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Android)
            .GetFeature<QuestBodyTrackingFeature>().enabled, Is.True);
        Assert.That(new QuestBodyTrackingManifest().ProvideManifestRequirement(), Is.Not.Null);
        var requirement = QuestBodyTrackingManifest.BuildRequirement();
        Assert.That(requirement.SupportedXRLoaders, Does.Contain(typeof(OpenXRLoader)));
        Assert.That(requirement.NewElements, Has.Count.EqualTo(3));
        AssertElement("uses-permission", "com.oculus.permission.BODY_TRACKING", null);
        AssertElement("uses-feature", "com.oculus.software.body_tracking", "false");
        AssertElement("uses-feature", "com.oculus.experimental.enabled", "false");

        void AssertElement(string kind, string name, string required)
        {
            var elements = requirement.NewElements.FindAll(item => item.ElementPath.Count == 2
                && item.ElementPath[0] == "manifest" && item.ElementPath[1] == kind
                && item.Attributes.TryGetValue("name", out string actual) && actual == name);
            Assert.That(elements, Has.Count.EqualTo(1), name);
            if (required != null) Assert.That(elements[0].Attributes["required"], Is.EqualTo(required));
        }
    }

    [Test]
    public void AndroidManifestProcessorDiscoversAndWritesBodyRequirements()
    {
        Type providerType = TypeCache.GetTypesDerivedFrom<IAndroidManifestRequirementProvider>()
            .Single(type => type == typeof(QuestBodyTrackingManifest));
        Assert.That(providerType.GetConstructor(Type.EmptyTypes), Is.Not.Null);
        var provider = (IAndroidManifestRequirementProvider)Activator.CreateInstance(providerType);
        var manager = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(BuildTargetGroup.Android).AssignedSettings;
        Assert.That(manager.activeLoaders.Any(loader => loader is OpenXRLoader), Is.True);

        string directory = Path.Combine(Path.GetTempPath(), "unframe-body-manifest-" + Guid.NewGuid().ToString("N"));
        string package = Path.Combine(directory, "package");
        string gradle = Path.Combine(directory, "gradle");
        string template = Path.Combine(package, "xrmanifest.androidlib", "AndroidManifest.xml");
        string unityManifest = Path.Combine(gradle, "src", "main", "AndroidManifest.xml");
        string output = Path.Combine(gradle, "xrmanifest.androidlib", "AndroidManifest.xml");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(template));
            Directory.CreateDirectory(Path.GetDirectoryName(unityManifest));
            const string xml = "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"><application /></manifest>";
            File.WriteAllText(template, xml);
            File.WriteAllText(unityManifest, xml);

            Type processorType = typeof(ManifestRequirement).Assembly.GetType("Unity.XR.Management.AndroidManifest.Editor.AndroidManifestProcessor");
            Assert.That(processorType, Is.Not.Null);
            object processor = Activator.CreateInstance(processorType, BindingFlags.Instance | BindingFlags.NonPublic,
                null, new object[] { gradle, package, manager }, null);
            processorType.GetMethod("ProcessManifestRequirements", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(processor, new object[] { new List<IAndroidManifestRequirementProvider> { provider } });

            var manifest = new XmlDocument();
            manifest.Load(output);
            AssertElement("uses-permission", "com.oculus.permission.BODY_TRACKING", null);
            AssertElement("uses-feature", "com.oculus.software.body_tracking", "false");
            AssertElement("uses-feature", "com.oculus.experimental.enabled", "false");

            void AssertElement(string kind, string name, string required)
            {
                var elements = manifest.DocumentElement.ChildNodes.OfType<XmlElement>()
                    .Where(element => element.LocalName == kind
                        && element.GetAttribute("name", "http://schemas.android.com/apk/res/android") == name).ToArray();
                Assert.That(elements, Has.Length.EqualTo(1), name);
                if (required != null)
                    Assert.That(elements[0].GetAttribute("required", "http://schemas.android.com/apk/res/android"), Is.EqualTo(required));
            }
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private static Type Native(string name) => FeatureType.GetNestedType(name, BindingFlags.NonPublic);
    private static object Constant(string name) => FeatureType.GetField(name, BindingFlags.NonPublic | BindingFlags.Static).GetRawConstantValue();
    private static void SetField(object target, string name, object value) => FeatureType.GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).SetValue(target, value);
    private static object GetField(object target, string name) => FeatureType.GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).GetValue(target);

    private static bool ConvertHip(ulong flags, float x, float y, float z, out Vector3 position, out Quaternion rotation)
    {
        Type vectorType = Native("Vector3f");
        Type quaternionType = Native("Quaternionf");
        Type poseType = Native("Posef");
        Type jointType = Native("BodyJointLocation");
        object nativePosition = Activator.CreateInstance(vectorType);
        vectorType.GetField("X").SetValue(nativePosition, x);
        vectorType.GetField("Y").SetValue(nativePosition, y);
        vectorType.GetField("Z").SetValue(nativePosition, z);
        object nativeRotation = Activator.CreateInstance(quaternionType);
        quaternionType.GetField("X").SetValue(nativeRotation, 0.1f);
        quaternionType.GetField("Y").SetValue(nativeRotation, 0.2f);
        quaternionType.GetField("Z").SetValue(nativeRotation, 0.3f);
        quaternionType.GetField("W").SetValue(nativeRotation, 0.9f);
        object pose = Activator.CreateInstance(poseType);
        poseType.GetField("Position").SetValue(pose, nativePosition);
        poseType.GetField("Orientation").SetValue(pose, nativeRotation);
        object joint = Activator.CreateInstance(jointType);
        jointType.GetField("LocationFlags").SetValue(joint, flags);
        jointType.GetField("Pose").SetValue(joint, pose);
        object[] args = { joint, null, null };
        bool available = (bool)FeatureType.GetMethod("TryConvertTrackedJoint", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, args);
        position = (Vector3)args[1];
        rotation = (Quaternion)args[2];
        return available;
    }

}
