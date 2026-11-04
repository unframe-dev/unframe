using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;

public sealed class QuestPresenterHudViewTests
{
    private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    [TestCase(48)]
    [TestCase(80)]
    [TestCase(95)]
    public void HudStaysAtTheLowerLeftEdgeAndAtTheMotionGuidesNearDistance(float fieldOfView)
    {
        Vector3 head = new Vector3(1, 2, 3);
        Quaternion yaw = Quaternion.Euler(0, 55, 0);
        Vector3 position = QuestPresenterHudView.GetPosition(head, yaw, fieldOfView, 4f / 3);
        Vector3 offset = Quaternion.Inverse(yaw) * (position - head);
        Assert.That(offset.x, Is.LessThan(0));
        Assert.That(offset.y, Is.LessThan(0));
        Assert.That(offset.magnitude, Is.EqualTo(.5f).Within(.00001f));
        Vector3 guideOffset = QuestMotionGuideGeometry.GetAnchorPosition(head, yaw, fieldOfView, 4f / 3) - head;
        Assert.That(offset.magnitude, Is.EqualTo(guideOffset.magnitude).Within(.00001f));
        float halfHeight = Mathf.Tan(fieldOfView * Mathf.Deg2Rad * .5f);
        Assert.That(.5f + offset.x / (2 * offset.z * halfHeight * 4f / 3), Is.InRange(.05f, .3f));
        Assert.That(.5f + offset.y / (2 * offset.z * halfHeight), Is.InRange(.1f, .4f));
    }

    [Test]
    public void HudFollowsHeadTranslationAndYawButIgnoresPitchAndRoll()
    {
        Vector3 head = new Vector3(1, 2, 3);
        Quaternion yaw = Quaternion.Euler(0, 55, 0);
        Vector3 baseline = QuestPresenterHudView.GetPosition(head, yaw, 80, 4f / 3);
        Vector3 tilted = QuestPresenterHudView.GetPosition(head, Quaternion.Euler(35, 55, 25), 80, 4f / 3);
        Assert.That(Vector3.Distance(baseline, tilted), Is.LessThan(.00001f));
        Vector3 shift = new Vector3(2, -.3f, -1);
        Assert.That(Vector3.Distance(QuestPresenterHudView.GetPosition(head + shift, yaw, 80, 4f / 3), baseline + shift), Is.LessThan(.00001f));
        Assert.That(Vector3.Distance(QuestPresenterHudView.GetPosition(head, Quaternion.identity, 80, 4f / 3), baseline), Is.GreaterThan(.1f));
    }

    [TestCase(0, 55, 0)]
    [TestCase(15, 55, 20)]
    [TestCase(-15, -30, -20)]
    public void PeripheralHudFacesTheActualCameraWithoutMirroringItsText(float pitch, float yaw, float roll)
    {
        Vector3 head = new Vector3(1, 2, 3);
        Quaternion camera = Quaternion.Euler(pitch, yaw, roll);
        Vector3 panel = QuestPresenterHudView.GetPosition(head, camera, 80, 4f / 3);
        Quaternion facing = QuestMotionGuideGeometry.GetFacingRotation(panel, head, camera);
        Assert.That(Vector3.Dot(facing * Vector3.forward, (panel - head).normalized), Is.GreaterThan(.9999f));
        Assert.That(Vector3.Dot(facing * Vector3.up, camera * Vector3.up), Is.GreaterThan(0));
    }

    [Test]
    public void HudCreatesReadableNonInteractiveVisualsAndOwnsTheirLifetime()
    {
        var host = new GameObject("Presenter HUD lifecycle test");
        try
        {
            var hud = host.AddComponent<QuestPresenterHudView>();
            typeof(QuestPresenterHudView).GetMethod("EnsureVisuals", PrivateInstance).Invoke(hud, null);
            var visuals = (GameObject)typeof(QuestPresenterHudView).GetField("visuals", PrivateInstance).GetValue(hud);
            Assert.That(visuals, Is.Not.Null);
            Canvas canvas = visuals.GetComponent<Canvas>();
            Assert.That(canvas.renderMode, Is.EqualTo(RenderMode.WorldSpace));
            Assert.That(canvas.GetComponent<GraphicRaycaster>(), Is.Null);
            Assert.That(visuals.GetComponentsInChildren<Graphic>(true).All(graphic => !graphic.raycastTarget), Is.True);
            Text text = visuals.GetComponentInChildren<Text>(true);
            Assert.That(text.font, Is.SameAs(QuestPresentationUiFont.Load()));
            text.text = "現在ページ: 1ページ目";
            Text elapsed = (Text)typeof(QuestPresenterHudView).GetField("elapsedLabel", PrivateInstance).GetValue(hud);
            elapsed.text = "経過時間: 01:23";
            Canvas.ForceUpdateCanvases();
            Assert.That(text.preferredHeight, Is.LessThanOrEqualTo(text.rectTransform.rect.height));
            Assert.That(elapsed.preferredHeight, Is.LessThanOrEqualTo(elapsed.rectTransform.rect.height));
            Assert.That(elapsed.fontSize, Is.LessThan(text.fontSize));
            Font font = text.font;
            const string characters = "現在ページ目経過時間";
            font.RequestCharactersInTexture(characters, text.fontSize, FontStyle.Normal);
            Assert.That(characters.All(character => font.HasCharacter(character)), Is.True);
            hud.enabled = false;
            typeof(QuestPresenterHudView).GetMethod("OnDisable", PrivateInstance).Invoke(hud, null);
            Assert.That(visuals.activeSelf, Is.False);
            typeof(QuestPresenterHudView).GetMethod("OnDestroy", PrivateInstance).Invoke(hud, null);
            Object.DestroyImmediate(hud);
            Assert.That(visuals == null, Is.True);
        }
        finally { Object.DestroyImmediate(host); }
    }
}
