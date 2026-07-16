using NUnit.Framework;
using UnityEditor;
using UnityEngine;

public class SlideNavigationEditModeTests
{
    [Test]
    public void SlideInputTester_FiresOnlyWhenControllerButtonBecomesPressed()
    {
        Assert.That(SlideInputTester.ShouldInvokeOnButtonState(isPressed: false, wasPressed: false), Is.False);
        Assert.That(SlideInputTester.ShouldInvokeOnButtonState(isPressed: true, wasPressed: false), Is.True);
        Assert.That(SlideInputTester.ShouldInvokeOnButtonState(isPressed: true, wasPressed: true), Is.False);
        Assert.That(SlideInputTester.ShouldInvokeOnButtonState(isPressed: false, wasPressed: true), Is.False);
    }

    [Test]
    public void SlideInputTester_TreatsTriggerInputAsControllerButtonPress()
    {
        Assert.That(SlideInputTester.IsControllerButtonPressed(
            primaryButton: false,
            secondaryButton: false,
            triggerButton: true,
            triggerValue: 0f,
            triggerPressThreshold: 0.1f
        ), Is.True);

        Assert.That(SlideInputTester.IsControllerButtonPressed(
            primaryButton: false,
            secondaryButton: false,
            triggerButton: false,
            triggerValue: 0.2f,
            triggerPressThreshold: 0.1f
        ), Is.True);
    }

    [Test]
    public void LocalSampleManifest_HasMultipleSlidesForSlideNavigation()
    {
        TextAsset manifest = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Scripts/_test/sample_manifest.json");

        Assert.That(manifest, Is.Not.Null);

        ManifestResponse response = JsonUtility.FromJson<ManifestResponse>(manifest.text);

        Assert.That(response.slides, Has.Count.GreaterThan(1));
    }
}
