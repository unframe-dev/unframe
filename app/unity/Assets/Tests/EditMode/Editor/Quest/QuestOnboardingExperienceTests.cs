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
        Assert.That(view.Panel.transform.Find("Alignment").GetComponent<Text>().text, Does.Contain("マーカー待ち"));
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

    [UnityTest]
    public IEnumerator DebugPreviewCanStillReturnToRoleSelectionWithoutAConnection()
    {
        yield return new EnterPlayMode();
        var view = CreateView();
        for (int i = 0; i < 4; i++) view.Flow.DebugNext();
        view.Refresh();
        Assert.That(view.FindButton("Begin").interactable, Is.True);
        view.FindButton("Begin").onClick.Invoke();
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(view.IsComplete, Is.False);
    }
}
