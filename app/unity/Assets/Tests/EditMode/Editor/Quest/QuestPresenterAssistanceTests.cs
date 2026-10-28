using System;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;

public sealed class QuestPresenterAssistanceTests
{
    private GameObject host;
    private GameObject head;
    private QuestPresentationSession session;

    private QuestPresentationStatusView CreateView()
    {
        host = new GameObject("Presenter assistance");
        var entry = host.AddComponent<QuestPresentationEntry>();
        session = host.AddComponent<QuestPresentationSession>();
        session.ConfigureConnection(new Uri("https://api.example.com/"), "session",
            _ => Task.FromResult("test-credential"));
        head = new GameObject("Head", typeof(Camera));
        var view = host.AddComponent<QuestPresentationStatusView>();
        view.Configure(entry, null, head.transform, session);
        return view;
    }

    [TearDown]
    public void TearDown()
    {
        if (host != null) Object.DestroyImmediate(host);
        if (head != null) Object.DestroyImmediate(head);
    }

    [Test]
    public void ExitIsAvailableFromMainMenuAndRequiresConfirmation()
    {
        var view = CreateView();
        Assert.That(view.FindButton("Exit").gameObject.activeSelf, Is.True);
        view.FindButton("Exit").onClick.Invoke();
        Assert.That(session.HasConnectionSettings, Is.True);
        Assert.That(view.FindButton("ConfirmExit").gameObject.activeSelf, Is.True);
        Assert.That(view.FindButton("ConfirmEnd").gameObject.activeSelf, Is.False);
        Assert.That(view.Panel.transform.Find("Status").GetComponent<Text>().text, Does.Contain("この端末"));
        view.FindButton("CancelEnd").onClick.Invoke();
        Assert.That(view.FindButton("Exit").gameObject.activeSelf, Is.True);
        Assert.That(session.HasConnectionSettings, Is.True);
    }

    [Test]
    public void ConfirmedExitClearsOnlyLocalConnection()
    {
        var view = CreateView();
        view.FindButton("Exit").onClick.Invoke();
        Assert.That(view.FindButton("ConfirmExit"), Is.Not.Null);
        view.FindButton("ConfirmExit").onClick.Invoke();
        Assert.That(session.HasConnectionSettings, Is.False);
    }

    [Test]
    public void UnconfiguredLogicalAdvanceIsNotOfferedAsAnAction()
    {
        var view = CreateView();
        Assert.That(view.FindButton("Next").gameObject.activeSelf, Is.False);
    }

    [Test]
    public void GuidePreferencesAreAvailableWithoutChangingTheSession()
    {
        var view = CreateView();
        view.FindButton("Details").onClick.Invoke();
        Assert.That(view.FindButton("Guide"), Is.Not.Null);
        view.FindButton("Guide").onClick.Invoke();
        Assert.That(view.FindButton("Guide").GetComponentInChildren<Text>().text, Does.Contain("非表示"));
        Assert.That(view.FindButton("GuideDetails").interactable, Is.False);
        Assert.That(session.HasConnectionSettings, Is.True);
    }

    [Test]
    public void ReopeningTheMenuAlwaysReturnsToPlaybackActions()
    {
        var view = CreateView();
        view.FindButton("Details").onClick.Invoke();
        view.SetMenuOpen(false);
        view.SetMenuOpen(true);
        Assert.That(view.FindButton("Resume").gameObject.activeSelf, Is.True);
        Assert.That(view.FindButton("Guide").gameObject.activeSelf, Is.False);
    }
}
