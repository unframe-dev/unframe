using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class QuestMotionGuideArmTests
{
    [Test]
    public void WaitingHintClearsArmsAndPreservesThePresenterInstruction()
    {
        var host = new GameObject("Motion guide hint lifecycle");
        try
        {
            using (var visuals = new QuestMotionGuideVisuals(host.transform))
            {
                visuals.Render(Unframe.Presentation.GestureKind.SpreadHands, 0, 1, Vector3.forward, Vector3.forward, Vector3.right, true, .4f);
                visuals.ShowHint("両手の追跡を待っています", "手を戻してください。X：操作・設定・退出", true, Vector3.forward, Vector3.forward);
                Assert.That(visuals.Visible, Is.True);
                Assert.That(visuals.Root.GetComponentsInChildren<MeshRenderer>(), Is.Empty);
                var labels = visuals.Root.GetComponentsInChildren<UnityEngine.UI.Text>();
                Assert.That(labels[0].text, Does.Contain("両手の追跡"));
                Assert.That(labels[1].text, Does.Contain("退出"));
                Assert.That(labels[0].color, Is.EqualTo(QuestUiTheme.Primary));
                Assert.That(labels[1].color, Is.EqualTo(QuestUiTheme.Text));
                visuals.Hide();
                Assert.That(visuals.Visible, Is.False);
            }
        }
        finally { Object.DestroyImmediate(host); }
    }

    [Test]
    public void ArmInstructionsUseCurrentBriefAndDetailedAssistance()
    {
        var host = new GameObject("Motion guide instructions");
        try
        {
            using (var visuals = new QuestMotionGuideVisuals(host.transform))
            {
                foreach (bool detailed in new[] { false, true })
                {
                    visuals.Render(Unframe.Presentation.GestureKind.SwipeLeft, 1, 3, Vector3.forward, Vector3.forward, Vector3.right, true, .4f, detailed);
                    var labels = visuals.Root.GetComponentsInChildren<UnityEngine.UI.Text>();
                    Assert.That(labels[0].text, Is.EqualTo(QuestMotionGuideState.Description(Unframe.Presentation.GestureKind.SwipeLeft)));
                    Assert.That(labels[1].text, Does.Contain(QuestMotionGuideState.InstructionFor(Unframe.Presentation.GestureKind.SwipeLeft, detailed)));
                    Assert.That(labels[1].text, Does.Contain("2 / 3"));
                    Assert.That(labels[1].text, Does.Contain("X：操作・設定・退出"));
                    Assert.That(labels[1].text.Contains("18cm"), Is.EqualTo(detailed));
                }
            }
        }
        finally { Object.DestroyImmediate(host); }
    }

    [TestCase(1)]
    [TestCase(2)]
    [TestCase(3)]
    [TestCase(4)]
    [TestCase(5)]
    [TestCase(6)]
    [TestCase(7)]
    [TestCase(8)]
    public void FoldedUpperArmsBeginInsideTheShouldersInTheHeadFrame(int preset)
    {
        foreach (double distance in new[] { .05, .2, .28, .35, 1 })
            foreach (bool left in new[] { true, false })
                foreach (float yawDegrees in new[] { 0, 90 })
                {
                    Quaternion yaw = Quaternion.Euler(0, yawDegrees, 0);
                    Vector3 side = yaw * (left ? Vector3.left : Vector3.right);
                    var pose = QuestMotionGuideGeometry.ArmPose(preset, distance, preset >= 7, left,
                        yaw * new Vector3(0, -.31f, 1.25f), yaw * Vector3.forward, yaw * Vector3.right, preset == 8 ? 1 : 0);
                    Assert.That(Vector3.Dot(pose.Elbow - pose.Shoulder, side), Is.LessThan(-.04f),
                        "The folded upper arm must point toward the body from its shoulder.");
                    Vector2 shoulder = Project(Quaternion.Inverse(yaw) * pose.Shoulder);
                    Vector2 elbow = Project(Quaternion.Inverse(yaw) * pose.Elbow);
                    Assert.That((elbow.x - shoulder.x) * (left ? -1 : 1), Is.LessThan(-.04f),
                        "The inward upper arm must also be obvious from the frontal preview.");
                }
    }

    [TestCase(1)]
    [TestCase(2)]
    [TestCase(3)]
    [TestCase(4)]
    [TestCase(5)]
    [TestCase(6)]
    [TestCase(7)]
    [TestCase(8)]
    public void ArmsFollowTheRequestedDirectionWithFixedShouldersAndRigidSegments(int preset)
    {
        foreach (bool left in new[] { true, false })
        {
            var start = QuestMotionGuideGeometry.ArmPose(preset, .28, preset >= 7, left, Vector3.zero, Vector3.forward, Vector3.right, 0);
            var end = QuestMotionGuideGeometry.ArmPose(preset, .28, preset >= 7, left, Vector3.zero, Vector3.forward, Vector3.right, 1);
            Vector3 direction = QuestMotionGuideGeometry.Direction(preset, Vector3.forward, Vector3.right, left);
            Assert.That(Vector3.Dot((end.Wrist - start.Wrist).normalized, direction), Is.GreaterThan(.999f));
            Assert.That(start.Shoulder, Is.EqualTo(end.Shoulder));
            for (int sample = 0; sample <= 10; sample++)
            {
                var pose = QuestMotionGuideGeometry.ArmPose(preset, .28, preset >= 7, left, Vector3.zero, Vector3.forward, Vector3.right, sample / 10f);
                Assert.That(Vector3.Distance(pose.Shoulder, pose.Elbow), Is.EqualTo(QuestMotionGuideGeometry.UpperArmLength).Within(.0001f));
                Assert.That(Vector3.Distance(pose.Elbow, pose.Wrist), Is.EqualTo(QuestMotionGuideGeometry.ForearmLength).Within(.0001f));
                Assert.That(float.IsNaN(pose.Elbow.x), Is.False);
            }
        }
    }

    [Test]
    public void BothArmsAreMirroredAndUseTheHeadYawFrame()
    {
        var left = QuestMotionGuideGeometry.ArmPose(7, .3, true, true, Vector3.zero, Vector3.forward, Vector3.right, .4f);
        var right = QuestMotionGuideGeometry.ArmPose(7, .3, true, false, Vector3.zero, Vector3.forward, Vector3.right, .4f);
        Assert.That(left.Wrist.x, Is.EqualTo(-right.Wrist.x).Within(.0001f));
        Assert.That(left.Shoulder.x, Is.EqualTo(-right.Shoulder.x).Within(.0001f));
        Assert.That(left.Elbow.x, Is.EqualTo(-right.Elbow.x).Within(.0001f));
        Quaternion yaw = Quaternion.Euler(0, 90, 0);
        var rotated = QuestMotionGuideGeometry.ArmPose(7, .3, true, true, Vector3.one, yaw * Vector3.forward, yaw * Vector3.right, .4f);
        Assert.That(Vector3.Distance(rotated.Wrist, Vector3.one + yaw * left.Wrist), Is.LessThan(.0001f));
        Assert.That(Vector3.Distance(rotated.Elbow, Vector3.one + yaw * left.Elbow), Is.LessThan(.0001f));
    }

    [Test]
    public void AnimationHoldsTheEndsAndReturnsSmoothlyBeforeRepeating()
    {
        Assert.That(QuestMotionGuideGeometry.MotionProgress(0), Is.Zero);
        Assert.That(QuestMotionGuideGeometry.MotionProgress(.1f), Is.Zero);
        Assert.That(QuestMotionGuideGeometry.MotionProgress(.3f), Is.InRange(.1f, .9f));
        Assert.That(QuestMotionGuideGeometry.MotionProgress(.6f), Is.EqualTo(1));
        Assert.That(QuestMotionGuideGeometry.MotionProgress(.8f), Is.InRange(.1f, .9f));
        Assert.That(QuestMotionGuideGeometry.MotionProgress(1), Is.Zero);
        Assert.That(Mathf.Abs(QuestMotionGuideGeometry.MotionProgress(.999f) - QuestMotionGuideGeometry.MotionProgress(.001f)), Is.LessThan(.001f));
        float previous = 0;
        for (int sample = 1; sample <= 1000; sample++)
        {
            float current = QuestMotionGuideGeometry.MotionProgress(sample / 1000f);
            Assert.That(Mathf.Abs(current - previous), Is.LessThan(.01f), "No frame should jump between the ends of the gesture.");
            previous = current;
        }
    }

    [TestCase(1)]
    [TestCase(2)]
    [TestCase(3)]
    [TestCase(4)]
    [TestCase(5)]
    [TestCase(6)]
    [TestCase(7)]
    [TestCase(8)]
    public void UpperArmAndForearmBothRotateAroundAnAnatomicalShoulder(int preset)
    {
        foreach (bool left in new[] { true, false })
        {
            var start = QuestMotionGuideGeometry.ArmPose(preset, .28, preset >= 7, left, Vector3.zero, Vector3.forward, Vector3.right, 0);
            var end = QuestMotionGuideGeometry.ArmPose(preset, .28, preset >= 7, left, Vector3.zero, Vector3.forward, Vector3.right, 1);
            Assert.That(start.Shoulder.y, Is.GreaterThan((start.Wrist.y + end.Wrist.y) * .5f));
            Assert.That(start.Shoulder.z, Is.LessThan(Mathf.Min(start.Wrist.z, end.Wrist.z)));
            Assert.That(Vector3.Angle(start.Elbow - start.Shoulder, end.Elbow - end.Shoulder), Is.GreaterThan(5));
            Assert.That(Vector3.Angle(start.Wrist - start.Elbow, end.Wrist - end.Elbow), Is.GreaterThan(5));
            Vector3 previousElbow = start.Elbow;
            for (int sample = 1; sample <= 100; sample++)
            {
                var pose = QuestMotionGuideGeometry.ArmPose(preset, .28, preset >= 7, left, Vector3.zero, Vector3.forward, Vector3.right, sample / 100f);
                Assert.That(Vector3.Distance(previousElbow, pose.Elbow), Is.LessThan(.015f));
                previousElbow = pose.Elbow;
            }
        }
    }

    [TestCase(7)]
    [TestCase(8)]
    public void BothArmsExtendAtTheElbowAndClosingRetracesTheSamePoses(int preset)
    {
        foreach (bool left in new[] { true, false })
        {
            Vector3 side = left ? Vector3.left : Vector3.right;
            var folded = QuestMotionGuideGeometry.ArmPose(7, .28, true, left, Vector3.zero, Vector3.forward, Vector3.right, 0);
            var extended = QuestMotionGuideGeometry.ArmPose(7, .28, true, left, Vector3.zero, Vector3.forward, Vector3.right, 1);
            Assert.That(ElbowAngle(folded), Is.InRange(70, 90), "The demonstration must begin with a bent elbow.");
            Assert.That(ElbowAngle(extended), Is.InRange(165, 175), "The upper arm and forearm must finish nearly straight.");
            Vector3 previewOrigin = new Vector3(0, -.31f, 1.25f);
            var foldedInPreview = QuestMotionGuideGeometry.ArmPose(7, .28, true, left, previewOrigin, Vector3.forward, Vector3.right, 0);
            var extendedInPreview = QuestMotionGuideGeometry.ArmPose(7, .28, true, left, previewOrigin, Vector3.forward, Vector3.right, 1);
            Assert.That(ProjectedElbowAngle(foldedInPreview), Is.LessThan(100), "The frontal preview must visibly begin folded.");
            Assert.That(ProjectedElbowAngle(extendedInPreview), Is.GreaterThan(165), "The frontal preview must visibly finish almost straight.");
            float previousAngle = float.NegativeInfinity;
            float previousOutward = float.NegativeInfinity;
            for (int sample = 0; sample <= 100; sample++)
            {
                float progress = sample / 100f;
                var pose = QuestMotionGuideGeometry.ArmPose(preset, .28, true, left, Vector3.zero, Vector3.forward, Vector3.right, progress);
                var reverse = QuestMotionGuideGeometry.ArmPose(preset == 7 ? 8 : 7, .28, true, left, Vector3.zero, Vector3.forward, Vector3.right, 1 - progress);
                Assert.That(Vector3.Distance(pose.Elbow, reverse.Elbow), Is.LessThan(.0001f));
                Assert.That(Vector3.Distance(pose.Wrist, reverse.Wrist), Is.LessThan(.0001f));
                float angle = ElbowAngle(pose) * (preset == 7 ? 1 : -1);
                Assert.That(angle, Is.GreaterThanOrEqualTo(previousAngle - .001f), "The elbow itself must continuously extend or fold.");
                previousAngle = angle;
                float outward = Vector3.Dot(pose.Wrist, side) * (preset == 7 ? 1 : -1);
                Assert.That(outward, Is.GreaterThanOrEqualTo(previousOutward - .0001f));
                previousOutward = outward;
            }
        }
    }

    private static float ElbowAngle(QuestMotionGuideArmPose pose) => Vector3.Angle(pose.Shoulder - pose.Elbow, pose.Wrist - pose.Elbow);
    private static float ProjectedElbowAngle(QuestMotionGuideArmPose pose) => Vector2.Angle(Project(pose.Shoulder) - Project(pose.Elbow), Project(pose.Wrist) - Project(pose.Elbow));

    [TestCase(7)]
    [TestCase(8)]
    public void BothHandWristsAndPalmTipsFollowVisibleArcsInsteadOfStraightChords(int preset)
    {
        foreach (bool left in new[] { true, false })
        {
            var origin = new Vector3(0, -.31f, 1.25f);
            var start = QuestMotionGuideGeometry.ArmPose(preset, .28, true, left, origin, Vector3.forward, Vector3.right, 0);
            var middle = QuestMotionGuideGeometry.ArmPose(preset, .28, true, left, origin, Vector3.forward, Vector3.right, .5f);
            var end = QuestMotionGuideGeometry.ArmPose(preset, .28, true, left, origin, Vector3.forward, Vector3.right, 1);
            Assert.That(DistanceFromChord(middle.Wrist, start.Wrist, end.Wrist), Is.GreaterThan(.05f), "The wrist must travel along a clearly curved path.");
            Assert.That(DistanceFromChord(PalmTip(middle), PalmTip(start), PalmTip(end)), Is.GreaterThan(.05f), "The visible end of the hand must also follow an arc.");
            Vector2 chord = Project(end.Wrist) - Project(start.Wrist);
            Vector2 toMiddle = Project(middle.Wrist) - Project(start.Wrist);
            float projectedDeviation = Mathf.Abs(chord.x * toMiddle.y - chord.y * toMiddle.x) / chord.magnitude;
            Assert.That(projectedDeviation, Is.GreaterThan(.03f), "The arc must be visible from the frontal preview camera.");
        }
    }

    private static Vector3 PalmTip(QuestMotionGuideArmPose pose) => pose.Wrist + (pose.Wrist - pose.Elbow).normalized * .08f;
    private static float DistanceFromChord(Vector3 point, Vector3 start, Vector3 end) => Vector3.Cross(point - start, end - start).magnitude / Vector3.Distance(start, end);

    [TestCase(7)]
    [TestCase(8)]
    public void BothArmSegmentsRemainVisibleWhileTheElbowExtends(int preset)
    {
        foreach (bool left in new[] { true, false })
            for (int sample = 0; sample <= 20; sample++)
            {
                var pose = QuestMotionGuideGeometry.ArmPose(preset, .28, true, left,
                    new Vector3(0, -.31f, 1.25f), Vector3.forward, Vector3.right, sample / 20f);
                Vector2 shoulder = Project(pose.Shoulder);
                Vector2 elbow = Project(pose.Elbow);
                Vector2 wrist = Project(pose.Wrist);
                Assert.That(Vector2.Distance(shoulder, wrist), Is.GreaterThan(.08f), "The wrist must not obscure the shoulder.");
                Assert.That(Vector2.Distance(shoulder, elbow), Is.GreaterThan(.06f));
                Assert.That(Vector2.Distance(elbow, wrist), Is.GreaterThan(.06f));
                Assert.That(Vector2.Angle(shoulder - elbow, wrist - elbow), Is.GreaterThan(25), "Both arm segments must remain distinct in the frontal view.");
            }
    }

    private static Vector2 Project(Vector3 point) => new Vector2(point.x / point.z, point.y / point.z);

    [TestCase(.05)]
    [TestCase(.35)]
    [TestCase(1)]
    public void DiagramScalingKeepsEveryGestureWithinTheRigidArmReach(double distance)
    {
        for (int preset = 1; preset <= 8; preset++)
            foreach (bool left in new[] { true, false })
                for (int sample = 0; sample <= 20; sample++)
                {
                    var pose = QuestMotionGuideGeometry.ArmPose(preset, distance, preset >= 7, left,
                        Vector3.zero, Vector3.forward, Vector3.right, sample / 20f);
                    Assert.That(Vector3.Distance(pose.Shoulder, pose.Wrist), Is.LessThan(QuestMotionGuideGeometry.UpperArmLength + QuestMotionGuideGeometry.ForearmLength));
                    Assert.That(Vector3.Distance(pose.Shoulder, pose.Elbow), Is.EqualTo(QuestMotionGuideGeometry.UpperArmLength).Within(.0001f));
                    Assert.That(Vector3.Distance(pose.Elbow, pose.Wrist), Is.EqualTo(QuestMotionGuideGeometry.ForearmLength).Within(.0001f));
                }
    }
}
