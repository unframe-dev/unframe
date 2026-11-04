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
    [TestCase(1, "トリガーを押したまま\n左へ薙ぎ払う")]
    [TestCase(7, "両トリガーを押したまま\n両手を広げる")]
    public void InstructionsExplainTheTriggerRequiredForTheGesture(int gesture, string expected)
    {
        var description = typeof(QuestMotionGuideView).GetMethod("Description",
            System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        Assert.That(description.Invoke(null, new object[] { gesture }), Is.EqualTo(expected));
    }

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

    [TestCase(0, 0, 0)]
    [TestCase(20, 90, 15)]
    [TestCase(-20, -135, -15)]
    [TestCase(90, 45, 0)]
    public void GuideAndInstructionStayNearAndBelowTheHorizontalView(float pitch, float yaw, float roll)
    {
        Vector3 headPosition = new Vector3(2, 1.6f, -3);
        Quaternion rotation = Quaternion.Euler(pitch, yaw, roll);
        Quaternion horizontal = QuestMotionGuideGeometry.GetYawRotation(rotation);
        Vector3 anchor = QuestMotionGuideGeometry.GetAnchorPosition(headPosition, rotation, 80, 1);
        Vector3 localAnchor = Quaternion.Inverse(horizontal) * (anchor - headPosition);
        Assert.That(Vector3.Distance(anchor, headPosition), Is.EqualTo(.5f).Within(.00001f));
        Assert.That(localAnchor.x, Is.GreaterThan(0));
        Assert.That(localAnchor.y, Is.LessThan(0));
        Assert.That(localAnchor.z, Is.GreaterThan(0));
        Assert.That(localAnchor.x / localAnchor.z / Mathf.Tan(40 * Mathf.Deg2Rad), Is.EqualTo(.62f).Within(.00001f));
        Assert.That(localAnchor.y / localAnchor.z / Mathf.Tan(40 * Mathf.Deg2Rad), Is.EqualTo(-.58f).Within(.00001f));
        Assert.That(Vector3.Dot(horizontal * Vector3.up, Vector3.up), Is.GreaterThan(.99999f));
        Vector3 localInstruction = Quaternion.Inverse(horizontal) *
            (QuestMotionGuideGeometry.GetInstructionPosition(anchor, rotation) - headPosition);
        Assert.That(localInstruction.x, Is.EqualTo(localAnchor.x).Within(.00001f));
        Assert.That(localInstruction.y - localAnchor.y, Is.EqualTo(.055f).Within(.00001f));
    }

    [Test]
    public void LookingUpOrTiltingTheHeadDoesNotMoveTheGuide()
    {
        Vector3 head = new Vector3(1, 1.7f, 2);
        var straight = QuestMotionGuideGeometry.GetAnchorPosition(head, Quaternion.Euler(0, 60, 0), 80, 1.3f);
        var tilted = QuestMotionGuideGeometry.GetAnchorPosition(head, Quaternion.Euler(45, 60, 30), 80, 1.3f);
        Assert.That(Vector3.Distance(straight, tilted), Is.LessThan(.00001f));
        var movedHead = head + new Vector3(.5f, .1f, -.2f);
        var movedGuide = QuestMotionGuideGeometry.GetAnchorPosition(movedHead, Quaternion.Euler(45, 60, 30), 80, 1.3f);
        Assert.That(Vector3.Distance(movedGuide - tilted, movedHead - head), Is.LessThan(.00001f));
    }

    [TestCase(48, 1.333333f)]
    [TestCase(80, 1)]
    [TestCase(80, .6f)]
    public void PeripheralAnchorsStayAtTheSameNearDistanceAndMirrorAcrossTheView(float verticalFov, float aspect)
    {
        Vector3 head = new Vector3(1, 1.7f, -2);
        Quaternion yaw = Quaternion.Euler(0, 55, 0);
        Vector3 guide = QuestMotionGuideGeometry.GetAnchorPosition(head, yaw, verticalFov, aspect);
        Vector3 hud = QuestMotionGuideGeometry.GetHudPosition(head, yaw, verticalFov, aspect);
        Assert.That(Vector3.Distance(head, guide), Is.EqualTo(.5f).Within(.00001f));
        Assert.That(Vector3.Distance(head, hud), Is.EqualTo(.5f).Within(.00001f));
        Vector3 localGuide = Quaternion.Inverse(yaw) * (guide - head);
        Vector3 localHud = Quaternion.Inverse(yaw) * (hud - head);
        Assert.That(localGuide.x, Is.EqualTo(-localHud.x).Within(.00001f));
        Assert.That(localGuide.y, Is.EqualTo(localHud.y).Within(.00001f));
        Assert.That(localGuide.z, Is.EqualTo(localHud.z).Within(.00001f));
        float halfHeight = localGuide.z * Mathf.Tan(verticalFov * .5f * Mathf.Deg2Rad);
        Assert.That(localGuide.x / (halfHeight * aspect), Is.EqualTo(.62f).Within(.00001f));
        Assert.That(localGuide.y / halfHeight, Is.EqualTo(-.58f).Within(.00001f));
    }

    [Test]
    public void NarrowViewsReduceVisualSizeWithoutMovingTheUiFurtherAway()
    {
        Assert.That(QuestMotionGuideGeometry.GetViewportScale(80, 1), Is.EqualTo(1).Within(.00001f));
        Assert.That(QuestMotionGuideGeometry.GetViewportScale(100, 1.6f), Is.EqualTo(1).Within(.00001f));
        Assert.That(QuestMotionGuideGeometry.GetViewportScale(80, .5f), Is.EqualTo(.5f).Within(.00001f));
        Assert.That(QuestMotionGuideGeometry.GetViewportScale(48, 1.3f), Is.InRange(.5f, .55f));
    }

    [TestCase(0, 0, 0)]
    [TestCase(35, 60, 20)]
    [TestCase(-30, -90, -15)]
    public void PeripheralPanelsFaceTheCameraWithoutTurningUpsideDown(float pitch, float yaw, float roll)
    {
        Vector3 head = new Vector3(1, 1.7f, -2);
        Quaternion headRotation = Quaternion.Euler(pitch, yaw, roll);
        foreach (float side in new[] { -1f, 1f })
        {
            Vector3 panel = head + QuestMotionGuideGeometry.GetYawRotation(headRotation)
                * new Vector3(side * .22f, -.17f, .45f);
            Quaternion facing = QuestMotionGuideGeometry.GetFacingRotation(panel, head, headRotation);
            Assert.That(Vector3.Dot(facing * Vector3.forward, (panel - head).normalized), Is.GreaterThan(.99999f));
            Assert.That(Vector3.Dot(facing * Vector3.up, headRotation * Vector3.up), Is.GreaterThan(0));
        }
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
            Assert.That(backplate.color.a, Is.InRange(.65f, .9f));
            Assert.That(backplate.sprite, Is.Not.Null);
            Assert.That(backplate.type, Is.EqualTo(UnityEngine.UI.Image.Type.Sliced));
            Assert.That(backplate.raycastTarget, Is.False);
            Assert.That(instruction.raycastTarget, Is.False);
            Assert.That(instruction.gameObject, Is.Not.SameAs(backplate.gameObject));
            Assert.That(instruction.transform.parent, Is.EqualTo(backplate.transform));
            Assert.That(Vector3.Distance(backplate.transform.localScale, Vector3.one * .00022f), Is.LessThan(.0000001f));
            Assert.That(backplate.transform.localRotation, Is.EqualTo(Quaternion.identity));
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
                Assert.That(animators[side].transform.localScale, Is.EqualTo(Vector3.one * .10f));
                Transform armModel = animators[side].transform.Find("ArmModel");
                Assert.That(armModel, Is.Not.Null);
                Assert.That(Vector3.Dot(armModel.localRotation * Vector3.forward, Vector3.back), Is.GreaterThan(.999f));
                Assert.That(animators[side].transform.localRotation, Is.EqualTo(Quaternion.identity));
                string resource = "PresentationUi/MotionArms/Editable/" + (side == 0 ? "LeftMotionArm" : "RightMotionArm");
                var prefab = Resources.Load<GameObject>(resource);
                Assert.That(prefab, Is.Not.Null, resource);
                Assert.That(meshes[side], Is.SameAs(prefab.GetComponentInChildren<SkinnedMeshRenderer>(true).sharedMesh));
                Assert.That(prefab.GetComponent<QuestMotionArmAppearance>(), Is.Not.Null);
                foreach (AnimationClip clip in controllers[side].animationClips)
                {
                    clip.SampleAnimation(animators[side].gameObject, clip.length * .6f);
                    Assert.That(Vector3.Dot(armModel.localRotation * Vector3.forward, Vector3.back),
                        Is.GreaterThan(.999f), clip.name + " must preserve the model facing correction.");
                }
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
