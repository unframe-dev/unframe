using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class QuestLocalPresentationStatusViewTests
{
    private GameObject host;
    private GameObject head;

    [TearDown]
    public void TearDown()
    {
        if (host != null) Object.DestroyImmediate(host);
        if (head != null) Object.DestroyImmediate(head);
    }

    [Test]
    public void StatusUsesLocalControlsAndDoesNotSerializeRuntimePanelIntoScene()
    {
        host = new GameObject("Local presentation");
        var controls = host.AddComponent<QuestLocalPresentationControls>();
        var view = host.AddComponent<QuestLocalPresentationStatusView>();
        head = new GameObject("Head", typeof(Camera));
        view.Configure(controls, head.transform);
        view.Refresh();

        Assert.That(view.StatusText, Is.EqualTo(controls.Summary));
        Assert.That(head.GetComponentInChildren<Canvas>(), Is.Null);
    }

    [Test]
    public void MissingConfigurationReportsLocalFailureWithoutNetworkState()
    {
        host = new GameObject("Local presentation");
        var view = host.AddComponent<QuestLocalPresentationStatusView>();
        view.Configure(null, null);

        Assert.That(view.StatusText, Is.EqualTo("Local presentation not configured"));
    }
}
