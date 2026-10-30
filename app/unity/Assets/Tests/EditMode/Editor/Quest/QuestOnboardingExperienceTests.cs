using System.Collections;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.TestTools;

public sealed class QuestOnboardingExperienceTests
{
    private GameObject host;
    private GameObject head;

    [TearDown]
    public void TearDown()
    {
        if (host != null) Object.DestroyImmediate(host);
        if (head != null) Object.DestroyImmediate(head);
    }

    [UnityTearDown]
    public IEnumerator LeavePlayMode()
    {
        if (Application.isPlaying) yield return new ExitPlayMode();
    }

    private QuestOnboardingView CreateView()
    {
        host = new GameObject("Preparation experience");
        head = new GameObject("Head", typeof(Camera));
        var view = host.AddComponent<QuestOnboardingView>();
        view.Configure(null, null, null, head.transform, null);
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        return view;
    }

    [UnityTest]
    public IEnumerator AlignmentCannotAdvanceBeforeCalibrationAndConnectionAreReady()
    {
        yield return new EnterPlayMode();
        var view = CreateView();
        view.Flow.GoTo(QuestOnboardingPage.Calibration);
        view.Refresh();
        Assert.That(view.FindButton("Aligned").interactable, Is.False);
        Vector3 target = view.FindButton("Aligned").transform.position;
        Assert.That(view.HandleRay(new Ray(head.transform.position, target - head.transform.position)), Is.True);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Calibration));
        Assert.That(view.Panel.transform.Find("Alignment").GetComponent<Text>().text, Does.Contain("頭をゆっくり動かします"));
    }

    [UnityTest]
    public IEnumerator StartCannotBePressedBeforeReadiness()
    {
        yield return new EnterPlayMode();
        var view = CreateView();
        view.Flow.GoTo(QuestOnboardingPage.Ready);
        view.Refresh();
        Assert.That(view.FindButton("Begin").interactable, Is.False);
    }

    [Test]
    public void PresenterUsesTheConfirmedLayoutWithoutDebugOrDiagnosticActions()
    {
        var view = CreateView();
        view.Refresh();
        Assert.That(view.FindButton("DebugNext"), Is.Null);
        Assert.That(view.FindButton("SaveDiagnostics"), Is.Null);
        var brand = view.Panel.transform.Find("Brand").GetComponent<Text>();
        Assert.That(brand.rectTransform.anchoredPosition, Is.EqualTo(new Vector2(0, 365)));
        Assert.That(view.Panel.GetComponent<CanvasScaler>().dynamicPixelsPerUnit, Is.EqualTo(2));
        Assert.That(view.Panel.GetComponent<UnityEngine.UI.Image>().color, Is.EqualTo((Color)new Color32(246, 243, 255, 255)));
    }

    [Test]
    public void AudienceCanJoinAnonymouslyWithoutDeviceApproval()
    {
        var view = CreateView();
        view.Flow.SelectRole(QuestOnboardingRole.Audience);
        typeof(QuestOnboardingView).GetField("roomCode", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
            .SetValue(view, "ABCDEFGH");
        view.Refresh();
        view.FindButton("Continue").onClick.Invoke();
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Join));
    }
}
