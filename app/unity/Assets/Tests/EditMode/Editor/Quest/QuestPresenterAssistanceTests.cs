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
    public void LocalDisconnectIsAvailableInSettingsWithoutAnExtraConfirmation()
    {
        var view = CreateView();
        Assert.That(view.FindButton("Exit").gameObject.activeSelf, Is.False);
        view.FindButton("Details").onClick.Invoke();
        Assert.That(view.FindButton("Exit").gameObject.activeSelf, Is.True);
        Assert.That(view.FindButton("Exit").GetComponentInChildren<Text>().text, Is.EqualTo("接続を解除"));
        Assert.That(view.FindButton("ConfirmExit"), Is.Null);
        Assert.That(session.HasConnectionSettings, Is.True);
        view.FindButton("Exit").onClick.Invoke();
        Assert.That(session.HasConnectionSettings, Is.False);
    }

    [Test]
    public void UnconfiguredLogicalAdvanceRemainsVisibleAndDisabled()
    {
        var view = CreateView();
        Assert.That(view.FindButton("Next").gameObject.activeSelf, Is.True);
        Assert.That(view.FindButton("Next").interactable, Is.False);
    }

    [Test]
    public void SettingsDoNotExposeTheReplacedGuidePreferencesOrDiagnosticAction()
    {
        var view = CreateView();
        view.FindButton("Details").onClick.Invoke();
        Assert.That(view.FindButton("Guide"), Is.Null);
        Assert.That(view.FindButton("GuideDetails"), Is.Null);
        Assert.That(view.FindButton("SaveDiagnostics"), Is.Null);
        Assert.That(session.HasConnectionSettings, Is.True);
    }

    [Test]
    public void ReopeningTheMenuPreservesItsSettingsPage()
    {
        var view = CreateView();
        view.FindButton("Details").onClick.Invoke();
        view.SetMenuOpen(false);
        view.SetMenuOpen(true);
        Assert.That(view.FindButton("Resume").gameObject.activeSelf, Is.False);
        Assert.That(view.FindButton("Exit").gameObject.activeSelf, Is.True);
        view.FindButton("Details").onClick.Invoke();
        Assert.That(view.FindButton("Resume").gameObject.activeSelf, Is.True);
        Assert.That(view.FindButton("Exit").gameObject.activeSelf, Is.False);
    }
}
