using System;
using NUnit.Framework;

public sealed class ArucoBuildRequirementTests
{
    [TestCase("", true)]
    [TestCase("OTHER;UNFRAME_OPENCV_FOR_UNITY_DISABLED", true)]
    [TestCase("UNFRAME_OPENCV_FOR_UNITY", false)]
    public void MarkerBuildRejectsDisabledOrMissingDetection(string symbols, bool installed)
    {
        Assert.Throws<InvalidOperationException>(() => QuestMrSceneBuild.ValidateMarkerDetection(symbols, installed));
    }

    [Test]
    public void MarkerBuildAcceptsInstalledEnabledDetection()
    {
        Assert.DoesNotThrow(() => QuestMrSceneBuild.ValidateMarkerDetection("OTHER;UNFRAME_OPENCV_FOR_UNITY", true));
    }
}
