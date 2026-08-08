using NUnit.Framework;
using UnityEngine;

public sealed class PresentationImportEditModeTests
{
    [Test]
    public void JsonUtility_ReadsPresentationAndElementContract()
    {
        const string json = "{\"schemaVersion\":\"1.0.0\",\"presentation\":{\"id\":\"demo\",\"groups\":[{\"id\":\"group_01\",\"elements\":[{\"id\":\"title\",\"type\":\"text\",\"content\":{\"text\":\"Hello\"},\"initialState\":{\"visible\":true}}]}]}}";

        PresentationDocument document = JsonUtility.FromJson<PresentationDocument>(json);

        Assert.That(document.schemaVersion, Is.EqualTo("1.0.0"));
        Assert.That(document.presentation.groups[0].elements[0].content.text, Is.EqualTo("Hello"));
        Assert.That(document.presentation.groups[0].elements[0].initialState.ResolveActive(), Is.True);
    }

    [Test]
    public void DefaultRegistrySupportsAllInitialElementTypes()
    {
        ElementLoaderRegistry registry = new ElementLoaderRegistry();

        Assert.That(new TextElementLoader().CanLoad("text"), Is.True);
        Assert.That(new ImageElementLoader().CanLoad("image"), Is.True);
        Assert.That(new VideoElementLoader().CanLoad("video"), Is.True);
        Assert.That(new ModelElementLoader().CanLoad("model"), Is.True);
        Assert.That(new AudioElementLoader().CanLoad("audio"), Is.True);
        Assert.That(new ShapeElementLoader().CanLoad("shape"), Is.True);
        Assert.That(registry, Is.Not.Null);
    }

    [Test]
    public void JsonUtility_IgnoresPolymorphicActionValueUntilActionImportIsAdded()
    {
        const string json = "{\"actions\":[{\"targetId\":\"earth\",\"type\":\"setVisible\",\"value\":true},{\"targetId\":\"earth\",\"type\":\"setPosition\",\"value\":[1,2,3]}]}";

        PresentationActionContainer container = JsonUtility.FromJson<PresentationActionContainer>(json);

        Assert.That(container.actions, Has.Length.EqualTo(2));
        Assert.That(container.actions[0].type, Is.EqualTo("setVisible"));
        Assert.That(container.actions[1].type, Is.EqualTo("setPosition"));
    }

    [Test]
    public void RuntimeState_StartsAtFirstGroupAndStep()
    {
        PresentationGroup group = new PresentationGroup
        {
            id = "group_01",
            steps = new[]
            {
                new PresentationStep { id = "step_01" },
                new PresentationStep { id = "step_02" }
            }
        };
        PresentationRuntimeState state = new PresentationRuntimeState();

        state.Reset(new PresentationData { groups = new[] { group } });

        Assert.That(state.CurrentGroupId, Is.EqualTo("group_01"));
        Assert.That(state.CurrentStepId, Is.EqualTo("step_01"));
        Assert.That(state.SetStep(group, "step_02"), Is.True);
        Assert.That(state.CurrentStepId, Is.EqualTo("step_02"));
    }

    [Test]
    public void RuntimeState_ProcessesCueOnlyFromCurrentStep()
    {
        PresentationGroup group = new PresentationGroup
        {
            id = "group_01",
            steps = new[]
            {
                new PresentationStep
                {
                    id = "step_01",
                    cues = new[]
                    {
                        new PresentationCue
                        {
                            id = "cue_01",
                            trigger = new PresentationTrigger
                            {
                                type = "input",
                                condition = new TriggerCondition { input = "primary" }
                            },
                            nextStep = "step_02"
                        }
                    }
                },
                new PresentationStep
                {
                    id = "step_02",
                    cues = new[]
                    {
                        new PresentationCue
                        {
                            id = "cue_02",
                            trigger = new PresentationTrigger
                            {
                                type = "input",
                                condition = new TriggerCondition { input = "secondary" }
                            }
                        }
                    }
                }
            }
        };
        PresentationRuntimeState state = new PresentationRuntimeState();
        PresentationData presentation = new PresentationData { groups = new[] { group } };
        state.Reset(presentation);

        Assert.That(state.TryProcessInput(presentation, "secondary", out _), Is.False);
        Assert.That(state.TryProcessInput(presentation, "primary", out PresentationCue cue), Is.True);
        Assert.That(cue.id, Is.EqualTo("cue_01"));
        Assert.That(state.CurrentStepId, Is.EqualTo("step_02"));
    }

    [Test]
    public void RuntimeState_DoesNotProcessSameCueTwice()
    {
        PresentationGroup group = new PresentationGroup
        {
            id = "group_01",
            steps = new[]
            {
                new PresentationStep
                {
                    id = "step_01",
                    cues = new[]
                    {
                        new PresentationCue
                        {
                            id = "cue_01",
                            trigger = new PresentationTrigger
                            {
                                type = "input",
                                condition = new TriggerCondition { input = "primary" }
                            }
                        }
                    }
                }
            }
        };
        PresentationData presentation = new PresentationData { groups = new[] { group } };
        PresentationRuntimeState state = new PresentationRuntimeState();
        state.Reset(presentation);

        Assert.That(state.TryProcessInput(presentation, "primary", out _), Is.True);
        Assert.That(state.TryProcessInput(presentation, "primary", out _), Is.False);
    }

    [Test]
    public void ActionExecutor_AppliesVisibilityAndTransformActions()
    {
        GameObject target = new GameObject("element");
        ElementRuntimeRegistry registry = new ElementRuntimeRegistry();
        ImportedElement imported = target.AddComponent<ImportedElement>();
        imported.ElementId = "element_01";
        registry.Register(target);

        PresentationActionExecutor executor = new PresentationActionExecutor(registry);
        executor.Execute(new PresentationAction
        {
            targetId = "element_01",
            type = "setVisible",
            boolValue = true
        });
        executor.Execute(new PresentationAction
        {
            targetId = "element_01",
            type = "setPosition",
            vectorValue = new[] { 1f, 2f, 3f }
        });

        Assert.That(target.activeSelf, Is.True);
        Assert.That(target.transform.localPosition, Is.EqualTo(new Vector3(1f, 2f, 3f)));
        Object.DestroyImmediate(target);
    }

    [System.Serializable]
    private sealed class PresentationActionContainer
    {
        public PresentationAction[] actions;
    }
}
