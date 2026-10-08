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
        Assert.That(notice, Does.Contain("No credentials"));
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
        Assert.That(view.Panel.transform.Find("MarkerStatus").GetComponent<Text>().text, Is.EqualTo("Alignment complete"));
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
