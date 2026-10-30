using System;
using NUnit.Framework;

public sealed class QuestLaunchConnectionSettingsTests
{
    [Test]
    public void ReleaseBuildRejectsCallerSuppliedConnection()
    {
        Assert.That(QuestLaunchConnectionSettings.TryRead(false, ReadValidExtra, out var settings), Is.False);
        Assert.That(settings, Is.Null);
    }

    [Test]
    public void ReleaseBuildDoesNotAccessLaunchExtras()
    {
        string ReadForbiddenExtra(string key) => throw new InvalidOperationException("Release must not access Intent data.");
        Assert.That(QuestLaunchConnectionSettings.TryRead(false, ReadForbiddenExtra, out var settings), Is.False);
        Assert.That(settings, Is.Null);
    }

    [Test]
    public void DevelopmentBuildReadsTemporaryConnection()
    {
        Assert.That(QuestLaunchConnectionSettings.TryRead(true, ReadValidExtra, out var settings), Is.True);
        Assert.That(settings.Origin, Is.EqualTo(new Uri("https://api.example.com/")));
        Assert.That(settings.SessionId, Is.EqualTo("session"));
        Assert.That(settings.Credential, Is.EqualTo("private-token"));
        Assert.That(settings.AdvanceLogicalEventName, Is.EqualTo("next"));
    }

    [Test]
    public void DevelopmentBuildAcceptsMissingOptionalLogicalEvent()
    {
        string ReadExtra(string key) => key == "unframe.advanceLogicalEvent" ? null : ReadValidExtra(key);
        Assert.That(QuestLaunchConnectionSettings.TryRead(true, ReadExtra, out var settings), Is.True);
        Assert.That(settings.AdvanceLogicalEventName, Is.Null);
    }

    [TestCase("unframe.controlPlaneOrigin")]
    [TestCase("unframe.sessionId")]
    [TestCase("unframe.credential")]
    public void DevelopmentBuildRejectsMissingRequiredSetting(string absentKey)
    {
        string ReadExtra(string key) => key == absentKey ? null : ReadValidExtra(key);
        Assert.That(QuestLaunchConnectionSettings.TryRead(true, ReadExtra, out var settings), Is.False);
        Assert.That(settings, Is.Null);
    }

    [TestCase("")]
    [TestCase("not a URI")]
    [TestCase("http://api.example.com/")]
    [TestCase("https://user:password@api.example.com/")]
    [TestCase("https://api.example.com/path")]
    [TestCase("https://api.example.com/?query=value")]
    [TestCase("https://api.example.com/#fragment")]
    public void DevelopmentBuildRejectsInvalidOrigin(string origin)
    {
        string ReadExtra(string key) => key == "unframe.controlPlaneOrigin" ? origin : ReadValidExtra(key);
        Assert.That(QuestLaunchConnectionSettings.TryRead(true, ReadExtra, out var settings), Is.False);
        Assert.That(settings, Is.Null);
    }

    [TestCase("unframe.sessionId")]
    [TestCase("unframe.credential")]
    public void DevelopmentBuildRejectsBlankRequiredSetting(string blankKey)
    {
        string ReadExtra(string key) => key == blankKey ? " " : ReadValidExtra(key);
        Assert.That(QuestLaunchConnectionSettings.TryRead(true, ReadExtra, out var settings), Is.False);
        Assert.That(settings, Is.Null);
    }

    private static string ReadValidExtra(string key)
    {
        switch (key)
        {
            case "unframe.controlPlaneOrigin": return "https://api.example.com/";
            case "unframe.sessionId": return "session";
            case "unframe.credential": return "private-token";
            case "unframe.advanceLogicalEvent": return "next";
            default: return null;
        }
    }
}
