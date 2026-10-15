using System.Reflection;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;

public sealed class QuestPresentationFlowViewTests
{
    private GameObject host;
    private GameObject head;
    private QuestPresentationFlowView view;
    private PresentationUiFlow flow;

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Flow view");
        head = new GameObject("Head", typeof(Camera));
        view = host.AddComponent<QuestPresentationFlowView>();
        view.Configure(head.transform);
        flow = new PresentationUiFlow();
    }

    [TearDown]
    public void TearDown()
    {
        // EditMode does not dispatch lifecycle callbacks for ordinary MonoBehaviours.
        typeof(QuestPresentationFlowView).GetMethod("OnDestroy", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Object.DestroyImmediate(host);
        Object.DestroyImmediate(head);
    }

    [Test]
    public void StartupIsCenteredInsideComfortableViewAndDoesNotSerializePanel()
    {
        view.Render(flow.State);
        var panel = view.Panel.GetComponent<RectTransform>();
        Assert.That(panel.localPosition.x, Is.Zero);
        Assert.That(panel.localPosition.y, Is.Zero);
        Assert.That(panel.localPosition.z, Is.EqualTo(1.4f));
        var angle = Mathf.Atan(panel.sizeDelta.x * panel.localScale.x * 0.5f / panel.localPosition.z) * Mathf.Rad2Deg;
        Assert.That(angle, Is.LessThan(25));
        Assert.That(view.Panel.hideFlags, Is.EqualTo(HideFlags.DontSave));
    }

    [Test]
    public void PanelAndActionsUseRoundedSlicedShapes()
    {
        view.Render(flow.State);
        var background = view.Panel.GetComponent<Image>();
        Assert.That(background.sprite, Is.Not.Null);
        Assert.That(background.type, Is.EqualTo(Image.Type.Sliced));
        Assert.That(background.sprite.border.x, Is.GreaterThan(0));
        Assert.That(background.sprite.texture.GetPixel(0, 0).a, Is.Zero);
        foreach (var button in view.Panel.GetComponentsInChildren<Button>())
        {
            Assert.That(button.image.sprite, Is.EqualTo(background.sprite));
            Assert.That(button.image.type, Is.EqualTo(Image.Type.Sliced));
        }
    }

    [Test]
    public void RoleActionsHaveLargeReadableLabels()
    {
        view.Render(flow.State);
        foreach (var name in new[] { "Audience", "Presenter" })
        {
            var label = view.FindButton(name).GetComponentInChildren<Text>();
            Assert.That(label.fontSize, Is.GreaterThanOrEqualTo(36));
            Assert.That(label.preferredHeight, Is.LessThanOrEqualTo(label.rectTransform.rect.height));
        }
    }

    [TestCase(PresentationUiPage.RoleSelection, false)]
    [TestCase(PresentationUiPage.RoomCode, false)]
    [TestCase(PresentationUiPage.AuthenticationPreview, false)]
    [TestCase(PresentationUiPage.RoomSetup, false)]
    [TestCase(PresentationUiPage.Calibration, false)]
    [TestCase(PresentationUiPage.Calibration, true)]
    [TestCase(PresentationUiPage.Presenting, true)]
    [TestCase(PresentationUiPage.ExitConfirmation, true)]
    public void EveryScreenKeepsReadableTextInsideThePanel(PresentationUiPage page, bool aligned)
    {
        OpenPage(page, aligned);
        view.Render(flow.State, "Hold still", 0.5f, 9, 25);
        if (page == PresentationUiPage.Presenting)
            view.SetGuidance(PresentationProgressGuidance.Create(flow.State, 9, 25, true, false,
                ArmMotionPreset.SpreadHands, ArmMotionPhase.WaitingTrigger, false));
        Canvas.ForceUpdateCanvases();
        var panel = view.Panel.GetComponent<RectTransform>();
        var corners = new Vector3[4];
        foreach (var label in view.Panel.GetComponentsInChildren<Text>())
        {
            Assert.That(label.preferredHeight, Is.LessThanOrEqualTo(label.rectTransform.rect.height + 1), label.name + " clips text");
            label.rectTransform.GetWorldCorners(corners);
            foreach (var corner in corners)
            {
                var position = panel.InverseTransformPoint(corner);
                Assert.That(Mathf.Abs(position.x), Is.LessThanOrEqualTo(panel.rect.width * 0.5f + 1), label.name);
                Assert.That(Mathf.Abs(position.y), Is.LessThanOrEqualTo(panel.rect.height * 0.5f + 1), label.name);
            }
        }
    }

    [Test]
    public void GuidanceShowsTheNextMotionAndUpdatesWithoutRebuildingThePanel()
    {
        OpenPage(PresentationUiPage.Presenting, true);
        view.Render(flow.State, eventNumber: 9, totalEvents: 25);
        var panel = view.Panel;
        view.SetGuidance(PresentationProgressGuidance.Create(flow.State, 9, 25, true, false,
            ArmMotionPreset.SwipeDown, ArmMotionPhase.WaitingTrigger, false));
        var title = panel.transform.Find("Next action/Guidance Title").GetComponent<Text>();
        var instruction = panel.transform.Find("Next action/Guidance Instruction").GetComponent<Text>();
        Assert.That(title.text, Is.EqualTo("Swipe down"));
        Assert.That(panel.transform.Find("Brand").GetComponent<Text>().text, Is.EqualTo("UP NEXT"));
        Assert.That(title.fontSize, Is.GreaterThanOrEqualTo(36));
        Assert.That(instruction.text, Does.Contain("trigger"));
        Assert.That(panel.transform.Find("Event").GetComponent<Text>().text, Is.EqualTo("STEP 9 / 25"));
        view.SetGuidance(PresentationProgressGuidance.Create(flow.State, 9, 25, true, false,
            ArmMotionPreset.SwipeDown, ArmMotionPhase.Failed, true));
        Assert.That(title.text, Is.EqualTo("Release trigger"));
        Assert.That(panel.transform.Find("Brand").GetComponent<Text>().text, Is.EqualTo("STATUS"));
        Assert.That(view.Panel, Is.SameAs(panel));
    }

    [Test]
    public void DisabledViewStaysHiddenAcrossScreenRebuild()
    {
        view.Render(flow.State);
        view.enabled = false;
        typeof(QuestPresentationFlowView).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        flow.SelectRole(PresentationUiRole.Audience);
        view.Render(flow.State);
        Assert.That(view.Panel.activeSelf, Is.False);
    }

    private void OpenPage(PresentationUiPage page, bool aligned)
    {
        if (page == PresentationUiPage.RoleSelection) return;
        if (page == PresentationUiPage.RoomCode)
        {
            flow.SelectRole(PresentationUiRole.Audience);
            return;
        }
        flow.SelectRole(PresentationUiRole.Presenter);
        if (page == PresentationUiPage.AuthenticationPreview) return;
        flow.ContinueAuthenticationPreview();
        if (page == PresentationUiPage.RoomSetup) return;
        flow.SelectPresentation("sample");
        flow.CreatePreviewRoom();
        if (aligned) flow.MarkCalibrationComplete();
        if (page == PresentationUiPage.Calibration) return;
        flow.EnterPresentation();
        if (page == PresentationUiPage.ExitConfirmation) flow.RequestExit();
    }

    [Test]
    public void AudienceRoomCodeRequiresSixDigitsAndSupportsDelete()
    {
        flow.SelectRole(PresentationUiRole.Audience);
        view.Render(flow.State);
        foreach (var digit in "12345") view.AppendRoomCode(digit);
        Assert.That(view.FindButton("Join").interactable, Is.False);
        view.AppendRoomCode('6');
        view.AppendRoomCode('7');
        Assert.That(view.RoomCodeDraft, Is.EqualTo("123456"));
        Assert.That(view.FindButton("Join").interactable, Is.True);
        string joined = null;
        view.RoomJoinRequested += code => joined = code;
        view.FindButton("Join").onClick.Invoke();
        Assert.That(joined, Is.EqualTo("123456"));
        view.BackspaceRoomCode();
        Assert.That(view.FindButton("Join").interactable, Is.False);
    }

    [Test]
    public void RoomCodeButtonsDoNotOverlap()
    {
        flow.SelectRole(PresentationUiRole.Audience);
        view.Render(flow.State);
        var buttons = view.Panel.GetComponentsInChildren<Button>();
        for (var first = 0; first < buttons.Length; first++)
        {
            var a = buttons[first].GetComponent<RectTransform>();
            var boundsA = new Rect(a.anchoredPosition - a.sizeDelta * 0.5f, a.sizeDelta);
            for (var second = first + 1; second < buttons.Length; second++)
            {
                var b = buttons[second].GetComponent<RectTransform>();
                var boundsB = new Rect(b.anchoredPosition - b.sizeDelta * 0.5f, b.sizeDelta);
                Assert.That(boundsA.Overlaps(boundsB), Is.False, buttons[first].name + " overlaps " + buttons[second].name);
            }
        }
    }

    [Test]
    public void PresenterAuthenticationCollectsNoCredentialsAndSaysPreview()
    {
        flow.SelectRole(PresentationUiRole.Presenter);
        view.Render(flow.State);
        Assert.That(view.Panel.GetComponentsInChildren<InputField>(), Is.Empty);
        Assert.That(view.FindButton("ContinuePreview"), Is.Not.Null);
        var notice = view.Panel.transform.Find("AuthNotice").GetComponent<Text>().text;
        Assert.That(notice, Is.EqualTo("No sign-in needed."));
    }

    [Test]
    public void CalibrationShowsReadyBeforeExplicitStart()
    {
        flow.SelectRole(PresentationUiRole.Audience);
        flow.JoinPreviewRoom("123456");
        view.Render(flow.State, "Hold still", 0.5f);
        Assert.That(view.FindButton("Start"), Is.Null);
        flow.MarkCalibrationComplete();
        view.Render(flow.State);
        Assert.That(view.Panel.transform.Find("MarkerStatus").GetComponent<Text>().text, Is.EqualTo("Aligned"));
        Assert.That(view.FindButton("Start"), Is.Not.Null);
    }

    [Test]
    public void AudienceCannotAdvanceAndLeaveRequiresConfirmation()
    {
        flow.SelectRole(PresentationUiRole.Audience);
        flow.JoinPreviewRoom("123456");
        flow.MarkCalibrationComplete();
        flow.EnterPresentation();
        view.Render(flow.State);
        Assert.That(view.FindButton("Next").interactable, Is.False);
        Assert.That(view.Panel.transform.localPosition.y, Is.LessThan(0));
        view.ExitRequested += () => flow.RequestExit();
        view.FindButton("Exit").onClick.Invoke();
        view.Render(flow.State);
        Assert.That(view.FindButton("ConfirmExit"), Is.Not.Null);
        Assert.That(view.FindButton("CancelExit"), Is.Not.Null);
    }

    [Test]
    public void RayPressesVisibleButtonButCannotPressDisabledView()
    {
        view.Render(flow.State);
        var audience = view.FindButton("Audience");
        var selected = PresentationUiRole.None;
        view.RoleSelected += role => selected = role;
        var ray = new Ray(head.transform.position, audience.transform.position - head.transform.position);
        Assert.That(view.TryPress(ray), Is.True);
        Assert.That(selected, Is.EqualTo(PresentationUiRole.Audience));
        view.enabled = false;
        typeof(QuestPresentationFlowView).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Assert.That(view.Panel.activeSelf, Is.False);
        Assert.That(view.TryPress(ray), Is.False);
    }
}
