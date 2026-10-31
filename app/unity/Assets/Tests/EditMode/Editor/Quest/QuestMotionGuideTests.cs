using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using Vector3 = UnityEngine.Vector3;
using Quaternion = UnityEngine.Quaternion;
using Transform = UnityEngine.Transform;

public sealed class QuestMotionGuideTests
{
    [Test]
    public void CurrentRecognitionCatalogProducesOnlySupportedTrackedGestures()
    {
        var catalog = new PresenterRecognitionCatalog();
        catalog.Gestures.Add(GestureKind.SwipeLeft);
        catalog.Gestures.Add(GestureKind.SpreadHands);
        catalog.Gestures.Add((GestureKind)999);
        var state = new QuestMotionGuideState();
        var progression = new ProgressionRuntimeState { Stable = new StableProgression() };
        state.Refresh(catalog, progression, true, true, true, true, true, false, false);
        Assert.That(state.Candidates, Is.EqualTo(new[] { GestureKind.SwipeLeft }));
        state.Refresh(catalog, progression, true, true, true, true, true, true, false);
        Assert.That(state.Candidates, Is.EqualTo(new[] { GestureKind.SwipeLeft, GestureKind.SpreadHands }));
        progression.Transitioning = new TransitioningProgression();
        state.Refresh(catalog, progression, true, true, true, true, true, true, false);
        Assert.That(state.Candidates, Is.Empty);
    }

    [TestCase(false, true, true, true, true, true, false)]
    [TestCase(true, false, true, true, true, true, false)]
    [TestCase(true, true, false, true, true, true, false)]
    [TestCase(true, true, true, false, true, true, false)]
    [TestCase(true, true, true, true, false, false, false)]
    [TestCase(true, true, true, true, true, true, true)]
    public void UnsafeOrHiddenStatesClearCandidates(bool presenter, bool calibrated, bool running, bool head, bool left, bool right, bool menu)
    {
        var catalog = new PresenterRecognitionCatalog();
        catalog.Gestures.Add(GestureKind.SwipeLeft);
        var state = new QuestMotionGuideState();
        state.Refresh(catalog, new ProgressionRuntimeState { Stable = new StableProgression() }, presenter, calibrated, running, head, left, right, menu);
        Assert.That(state.Candidates, Is.Empty);
    }

    [TestCase(25, 90)]
    [TestCase(90, 0)]
    [TestCase(-90, 135)]
    public void GestureFrameStaysHorizontalWhenTheInstructionFollowsTheHead(float pitch, float yaw)
    {
        QuestMotionGuideGeometry.GetFrame(Quaternion.Euler(pitch, yaw, 0), out Vector3 forward, out Vector3 right);
        Assert.That(forward.y, Is.EqualTo(0).Within(.00001f));
        Assert.That(right.y, Is.EqualTo(0).Within(.00001f));
        Assert.That(forward.magnitude, Is.EqualTo(1).Within(.00001f));
        Assert.That(right.magnitude, Is.EqualTo(1).Within(.00001f));
        Assert.That(Vector3.Dot(forward, right), Is.EqualTo(0).Within(.00001f));
        Assert.That(Vector3.Dot(forward, Quaternion.Euler(0, yaw, 0) * Vector3.forward), Is.GreaterThan(.999f));
    }

    [Test]
    public void VisualsUseEditableControllersAndPreserveSharedAssetsWhenDestroyed()
    {
        var host = new GameObject("Motion guide lifecycle");
        Mesh[] meshes = null;
        Material[] materials = null;
        RuntimeAnimatorController[] controllers = null;
        try
        {
            var view = host.AddComponent<QuestMotionGuideView>();
            var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
            typeof(QuestMotionGuideView).GetMethod("EnsureVisuals", flags).Invoke(view, null);
            Assert.That(host.GetComponentsInChildren<Collider>(true), Is.Empty);
            var backplate = host.GetComponentInChildren<UnityEngine.UI.Image>(true);
            var instruction = host.GetComponentInChildren<UnityEngine.UI.Text>(true);
            Assert.That(backplate, Is.Not.Null);
            Assert.That(backplate.color.a, Is.GreaterThanOrEqualTo(.9f));
            Assert.That(backplate.raycastTarget, Is.False);
            Assert.That(instruction.raycastTarget, Is.False);
            Assert.That(instruction.gameObject, Is.Not.SameAs(backplate.gameObject));
            Assert.That(instruction.transform.parent, Is.EqualTo(backplate.transform));
            var skins = host.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            Assert.That(skins.Length, Is.EqualTo(2));
            Assert.That(skins[0].sharedMesh, Is.Not.SameAs(skins[1].sharedMesh));
            Assert.That(System.Array.Exists(skins[0].bones, bone => bone != null && bone.name == "Forearm.L"), Is.True);
            Assert.That(System.Array.Exists(skins[1].bones, bone => bone != null && bone.name == "Forearm.R"), Is.True);
            meshes = new[] { skins[0].sharedMesh, skins[1].sharedMesh };
            materials = new[] { skins[0].sharedMaterial, skins[1].sharedMaterial };
            var animators = System.Array.FindAll(host.GetComponentsInChildren<Animator>(true), animator => animator.enabled);
            Assert.That(animators.Length, Is.EqualTo(2));
            controllers = new[] { animators[0].runtimeAnimatorController, animators[1].runtimeAnimatorController };
            for (int side = 0; side < animators.Length; side++)
            {
                Assert.That(controllers[side], Is.Not.Null);
                Assert.That(controllers[side].animationClips.Length, Is.EqualTo(8));
                Assert.That(animators[side].applyRootMotion, Is.False);
                Assert.That(animators[side].updateMode, Is.EqualTo(AnimatorUpdateMode.UnscaledTime));
                string resource = "PresentationUi/MotionArms/Editable/" + (side == 0 ? "LeftMotionArm" : "RightMotionArm");
                var prefab = Resources.Load<GameObject>(resource);
                Assert.That(prefab, Is.Not.Null, resource);
                Assert.That(meshes[side], Is.SameAs(prefab.GetComponentInChildren<SkinnedMeshRenderer>(true).sharedMesh));
                Assert.That(prefab.GetComponent<QuestMotionArmAppearance>(), Is.Not.Null);
            }
        }
        finally { Object.DestroyImmediate(host); }
        foreach (Mesh mesh in meshes) Assert.That(mesh != null, Is.True, "Shared source mesh was destroyed");
        foreach (Material material in materials) Assert.That(material != null, Is.True, "Shared material was destroyed");
        foreach (RuntimeAnimatorController controller in controllers) Assert.That(controller != null, Is.True, "Shared controller was destroyed");
    }

    [TestCase("Left")]
    [TestCase("Right")]
    public void EditableClipsExposeBoneTransformsAndOpacity(string side)
    {
        var prefab = Resources.Load<GameObject>("PresentationUi/MotionArms/Editable/" + side + "MotionArm");
        Assert.That(prefab, Is.Not.Null);
        var controller = prefab.GetComponent<Animator>().runtimeAnimatorController;
        Assert.That(controller, Is.Not.Null);
        foreach (GestureKind gesture in System.Enum.GetValues(typeof(GestureKind)))
        {
            if (gesture < GestureKind.SwipeLeft || gesture > GestureKind.CloseHands) continue;
            var clip = System.Array.Find(controller.animationClips, item => item.name == side + gesture);
            Assert.That(clip, Is.Not.Null, gesture.ToString());
            var bindings = UnityEditor.AnimationUtility.GetCurveBindings(clip);
            Assert.That(System.Array.Exists(bindings, binding => binding.type == typeof(Transform)
                && binding.propertyName.StartsWith("m_LocalRotation", System.StringComparison.Ordinal)), Is.True);
            Assert.That(System.Array.Exists(bindings, binding => binding.type == typeof(QuestMotionArmAppearance)
                && binding.propertyName == "Opacity"), Is.True);
        }
    }

    [TestCase("Left")]
    [TestCase("Right")]
    public void EveryEditableGestureAnimatesTheImportedBones(string side)
    {
        var prefab = Resources.Load<GameObject>("PresentationUi/MotionArms/Editable/" + side + "MotionArm");
        Assert.That(prefab, Is.Not.Null);
        var instance = Object.Instantiate(prefab);
        try
        {
            var animator = instance.GetComponent<Animator>();
            animator.enabled = false;
            var bones = instance.GetComponentInChildren<SkinnedMeshRenderer>().bones;
            foreach (AnimationClip clip in animator.runtimeAnimatorController.animationClips)
            {
                clip.SampleAnimation(instance, clip.length * .2f);
                var rotations = System.Array.ConvertAll(bones, bone => bone.localRotation);
                clip.SampleAnimation(instance, clip.length * .6f);
                bool moved = false;
                for (int i = 0; i < bones.Length; i++)
                    moved |= Quaternion.Angle(rotations[i], bones[i].localRotation) > .5f;
                Assert.That(moved, Is.True, clip.name + " must move the imported arm bones.");
                Assert.That(instance.GetComponent<QuestMotionArmAppearance>().Opacity, Is.InRange(0, 1));
            }
        }
        finally { Object.DestroyImmediate(instance); }
    }

}
