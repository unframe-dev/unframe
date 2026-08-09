using NUnit.Framework;
using System.Collections.Generic;
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
    public void Parser_ConvertsPolymorphicActionValues()
    {
        const string json = "{\"schemaVersion\":\"1.0.0\",\"presentation\":{\"groups\":[{\"id\":\"group_01\",\"steps\":[{\"id\":\"step_01\",\"cues\":[{\"id\":\"cue_01\",\"actions\":[{\"targetId\":\"earth\",\"type\":\"setVisible\",\"value\":true},{\"targetId\":\"earth\",\"type\":\"setPosition\",\"value\":[1,2,3]}]}]}]}]}}";

        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
        Assert.That(parser.TryParse(json, out PresentationDocument document, out string error), Is.True, error);

        PresentationAction[] actions = document.presentation.groups[0].steps[0].cues[0].actions;
        Assert.That(actions, Has.Length.EqualTo(2));
        Assert.That(actions[0].boolValue, Is.True);
        Assert.That(actions[1].vectorValue, Is.EqualTo(new[] { 1f, 2f, 3f }));
    }

    [Test]
    public void Parser_HandlesActionPropertyOrderAndTransition()
    {
        const string json = "{\"presentation\":{\"groups\":[{\"steps\":[{\"cues\":[{\"actions\":[{\"value\":[4,5,6],\"transition\":{\"easing\":\"easeInOut\",\"duration\":0.5},\"type\":\"setPosition\",\"targetId\":\"model\"}]}]}]}]}}";

        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
        Assert.That(parser.TryParse(json, out PresentationDocument document, out string error), Is.True, error);

        PresentationAction action = document.presentation.groups[0].steps[0].cues[0].actions[0];
        Assert.That(action.targetId, Is.EqualTo("model"));
        Assert.That(action.vectorValue, Is.EqualTo(new[] { 4f, 5f, 6f }));
        Assert.That(action.transition.duration, Is.EqualTo(0.5f));
        Assert.That(action.transition.easing, Is.EqualTo("easeInOut"));
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
    public void LocalSample_ContainsControllerDrivenSteps()
    {
        TextAsset sample = Resources.Load<TextAsset>("PresentationSamples/LocalSample");
        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();

        Assert.That(sample, Is.Not.Null);
        Assert.That(parser.TryParse(sample.text, out PresentationDocument document, out string error), Is.True, error);

        PresentationStep firstStep = document.presentation.groups[0].steps[0];
        Assert.That(firstStep.cues[0].trigger.condition.input, Is.EqualTo("primary"));
        Assert.That(firstStep.cues[0].actions[0].boolValue, Is.False);
        Assert.That(firstStep.cues[0].nextStep, Is.EqualTo("step_02"));
    }

    [Test]
    public void ActionExecutor_AppliesVisibilityAndTransformActions()
    {
        GameObject target = new GameObject("element");
        ElementRuntimeRegistry registry = new ElementRuntimeRegistry();
        ImportedElement imported = target.AddComponent<ImportedElement>();
        imported.ElementId = "element_01";
        registry.Register(target);

        RecordingPresentationRuntimeLogger logger = new RecordingPresentationRuntimeLogger();
        PresentationActionExecutor executor = new PresentationActionExecutor(registry, logger);
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
        Assert.That(logger.Messages, Has.Some.EqualTo("Action: setVisible -> element_01 = True."));
        Assert.That(logger.Messages, Has.Some.EqualTo("Action: setPosition -> element_01."));
        Object.DestroyImmediate(target);
    }

    private sealed class RecordingPresentationRuntimeLogger : IPresentationRuntimeLogger
    {
        public readonly List<string> Messages = new List<string>();

        public void Info(string message) => Messages.Add(message);

        public void Warning(string message) => Messages.Add(message);

        public void Error(string message) => Messages.Add(message);
    }

}
