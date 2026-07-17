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
    public void SlideInputTester_IsDisabledByDefault()
    {
        GameObject inputObject = new GameObject("SlideInputTesterTest");

        try
        {
            SlideInputTester input = inputObject.AddComponent<SlideInputTester>();

            Assert.That(input.NavigationInputEnabled, Is.False);
        }
        finally
        {
            Object.DestroyImmediate(inputObject);
        }
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
    public void SlideInputTester_MapsGenericXrThumbstickToNavigationDirection()
    {
        Assert.That(
            SlideInputTester.ResolveHorizontalDirection(new Vector2(-0.8f, 0f), 0.5f),
            Is.EqualTo(-1)
        );
        Assert.That(
            SlideInputTester.ResolveHorizontalDirection(new Vector2(0.8f, 0f), 0.5f),
            Is.EqualTo(1)
        );
        Assert.That(
            SlideInputTester.ResolveHorizontalDirection(new Vector2(0.2f, 0f), 0.5f),
            Is.EqualTo(0)
        );
    }

    [Test]
    public void SlideInputTester_InvokesThumbstickOnlyOnDirectionEdge()
    {
        Assert.That(SlideInputTester.ShouldInvokeDirectionalInput(1, 0), Is.True);
        Assert.That(SlideInputTester.ShouldInvokeDirectionalInput(1, 1), Is.False);
        Assert.That(SlideInputTester.ShouldInvokeDirectionalInput(-1, 1), Is.True);
        Assert.That(SlideInputTester.ShouldInvokeDirectionalInput(0, 1), Is.False);
    }

    [Test]
    public void SlideController_CircularAngleAdvancesAtMostOneUnseenSlide()
    {
        ManifestCircularView circularView = new ManifestCircularView
        {
            startAngle = 0f,
            angleStep = 45f
        };

        Assert.That(
            SlideController.ResolveNextCircularSlideIndex(circularView, 180f, 0, 5),
            Is.EqualTo(1)
        );
        Assert.That(
            SlideController.ResolveNextCircularSlideIndex(circularView, 180f, 1, 5),
            Is.EqualTo(2)
        );
    }

    [Test]
    public void SlideController_CircularAngleRejectsClockwiseProgress()
    {
        ManifestCircularView circularView = new ManifestCircularView
        {
            startAngle = 0f,
            angleStep = 45f
        };

        Assert.That(
            SlideController.ResolveNextCircularSlideIndex(circularView, -30f, 0, 5),
            Is.EqualTo(0)
        );
    }

    [Test]
    public void SlideController_CircularSlideSwitchKeepsPresentationTransformUnchanged()
    {
        GameObject controllerObject = new GameObject("SlideControllerTest");
        GameObject presentationRoot = new GameObject("PresentationRoot");
        GameObject slideRoot1 = new GameObject("Slide_0");
        GameObject slideRoot2 = new GameObject("Slide_1");
        GameObject slideRoot3 = new GameObject("Slide_2");

        try
        {
            SlideController controller = controllerObject.AddComponent<SlideController>();
            BuiltPresentation presentation = new BuiltPresentation
            {
                presentationRoot = presentationRoot,
                usesCircularView = true,
                circularView = new ManifestCircularView
                {
                    enabled = true,
                    viewpointPosition = new ManifestVector3 { x = 0f, y = 1f, z = 0f }
                }
            };
            presentation.slides.Add(new BuiltSlide { slideRoot = slideRoot1, viewAngle = 0f });
            presentation.slides.Add(new BuiltSlide { slideRoot = slideRoot2, viewAngle = 45f });
            presentation.slides.Add(new BuiltSlide { slideRoot = slideRoot3, viewAngle = 90f });

            presentationRoot.transform.localPosition = new Vector3(2f, 3f, 4f);
            presentationRoot.transform.localRotation = Quaternion.Euler(5f, 15f, 25f);
            Vector3 initialPosition = presentationRoot.transform.localPosition;
            Quaternion initialRotation = presentationRoot.transform.localRotation;

            controller.SetPresentation(presentation);
            controller.NextSlide();

            Assert.That(controller.CurrentSlideIndex, Is.EqualTo(1));
            Assert.That(presentationRoot.transform.localPosition, Is.EqualTo(initialPosition));
            Assert.That(Quaternion.Angle(presentationRoot.transform.localRotation, initialRotation), Is.LessThan(0.001f));

            controller.ShowSlide(2);
            Assert.That(controller.CurrentSlideIndex, Is.EqualTo(2));
            Assert.That(presentationRoot.transform.localPosition, Is.EqualTo(initialPosition));
            Assert.That(Quaternion.Angle(presentationRoot.transform.localRotation, initialRotation), Is.LessThan(0.001f));
        }
        finally
        {
            Object.DestroyImmediate(controllerObject);
            Object.DestroyImmediate(presentationRoot);
            Object.DestroyImmediate(slideRoot1);
            Object.DestroyImmediate(slideRoot2);
            Object.DestroyImmediate(slideRoot3);
        }
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
