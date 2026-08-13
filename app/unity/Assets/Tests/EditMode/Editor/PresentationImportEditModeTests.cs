using NUnit.Framework;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.TestTools;

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
    public void LocalSamples_ContainNoModelElements()
    {
        foreach (string resourceName in new[]
        {
            "PresentationSamples/LocalSample",
            "PresentationSamples/LocalExtendedSample"
        })
        {
            TextAsset asset = Resources.Load<TextAsset>(resourceName);
            Assert.That(asset, Is.Not.Null, resourceName);

            PresentationDocument document = JsonUtility.FromJson<PresentationDocument>(asset.text);
            foreach (PresentationGroup group in document.presentation.groups)
            {
                foreach (PresentationElement element in group.elements)
                {
                    Assert.That(element.type, Is.Not.EqualTo("model"), resourceName);
                }
            }
        }
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
        const string json = "{\"presentation\":{\"groups\":[{\"steps\":[{\"cues\":[{\"id\":\"cue_01\",\"actions\":[{\"value\":[4,5,6],\"transition\":{\"easing\":\"easeInOut\",\"duration\":0.5},\"type\":\"setPosition\",\"targetId\":\"model\"}]}]}]}]}}";

        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
        Assert.That(parser.TryParse(json, out PresentationDocument document, out string error), Is.True, error);

        PresentationAction action = document.presentation.groups[0].steps[0].cues[0].actions[0];
        Assert.That(action.targetId, Is.EqualTo("model"));
        Assert.That(action.vectorValue, Is.EqualTo(new[] { 4f, 5f, 6f }));
        Assert.That(action.transition.duration, Is.EqualTo(0.5f));
        Assert.That(action.transition.easing, Is.EqualTo("easeInOut"));
    }

    [Test]
    public void Parser_RejectsSupportedActionWithoutRequiredValue()
    {
        const string json = "{\"presentation\":{\"groups\":[{\"steps\":[{\"cues\":[{\"id\":\"cue_01\",\"actions\":[{\"targetId\":\"title\",\"type\":\"setVisible\"}]}]}]}]}}";

        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
        Assert.That(parser.TryParse(json, out _, out string error), Is.False);
        Assert.That(error, Does.Contain("setVisible"));
        Assert.That(error, Does.Contain("boolean"));
    }

    [Test]
    public void Parser_RejectsSupportedActionWithWrongValueType()
    {
        const string json = "{\"presentation\":{\"groups\":[{\"steps\":[{\"cues\":[{\"id\":\"cue_01\",\"actions\":[{\"targetId\":\"title\",\"type\":\"setPosition\",\"value\":true}]}]}]}]}}";

        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
        Assert.That(parser.TryParse(json, out _, out string error), Is.False);
        Assert.That(error, Does.Contain("setPosition"));
        Assert.That(error, Does.Contain("three-number array"));
    }

    [Test]
    public void Parser_RejectsCueWithoutIdentifier()
    {
        const string json = "{\"presentation\":{\"groups\":[{\"steps\":[{\"cues\":[{\"trigger\":{\"type\":\"input\"}}]}]}]}}";

        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
        Assert.That(parser.TryParse(json, out _, out string error), Is.False);
        Assert.That(error, Does.Contain("cue"));
        Assert.That(error, Does.Contain("id"));
    }

    [Test]
    public void TriggerEvaluator_MatchesOnlyTheRequestedLogicalInputAndState()
    {
        PresentationTriggerEvaluator evaluator = new PresentationTriggerEvaluator();
        PresentationTrigger trigger = new PresentationTrigger
        {
            type = "input",
            condition = new TriggerCondition
            {
                input = "primary",
                state = "pressed"
            }
        };

        Assert.That(
            evaluator.Evaluate(trigger, new PresentationTriggerContext("primary", "pressed")),
            Is.True
        );
        Assert.That(
            evaluator.Evaluate(trigger, new PresentationTriggerContext("secondary", "pressed")),
            Is.False
        );
        Assert.That(
            evaluator.Evaluate(trigger, new PresentationTriggerContext("primary", "released")),
            Is.False
        );
    }

    [Test]
    public void TriggerEvaluator_RejectsInputTriggerWithoutLogicalInput()
    {
        PresentationTriggerEvaluator evaluator = new PresentationTriggerEvaluator();
        PresentationTrigger trigger = new PresentationTrigger
        {
            type = "input",
            condition = new TriggerCondition { state = "pressed" }
        };

        Assert.That(
            evaluator.Evaluate(
                trigger,
                new PresentationTriggerContext(
                    null,
                    motion: new PresentationMotionSnapshot(
                        Vector3.zero,
                        new Vector3(0.2f, 0f, 0f),
                        0.2f,
                        true
                    )
                )
            ),
            Is.False
        );
    }

    [Test]
    public void MotionTrigger_RequiresHeldButtonAndMatchesBuiltInPresets()
    {
        PresentationTriggerEvaluator evaluator = new PresentationTriggerEvaluator();
        PresentationTrigger trigger = new PresentationTrigger
        {
            type = "motion",
            reference = "swipe_right"
        };

        PresentationTriggerContext releasedContext = new PresentationTriggerContext(
            null,
            motion: new PresentationMotionSnapshot(
                Vector3.zero,
                new Vector3(0.2f, 0f, 0f),
                0.2f,
                false
            )
        );
        PresentationTriggerContext heldContext = new PresentationTriggerContext(
            null,
            motion: new PresentationMotionSnapshot(
                Vector3.zero,
                new Vector3(0.2f, 0f, 0f),
                0.2f,
                true
            )
        );

        Assert.That(evaluator.Evaluate(trigger, releasedContext), Is.False);
        Assert.That(evaluator.Evaluate(trigger, heldContext), Is.True);
    }

    [Test]
    public void MotionTrigger_UsesPresetMaximumDurationWhenConditionIsMissing()
    {
        PresentationTriggerEvaluator evaluator = new PresentationTriggerEvaluator();
        PresentationTrigger trigger = new PresentationTrigger
        {
            type = "motion",
            reference = "swipe_right"
        };

        Assert.That(
            evaluator.Evaluate(
                trigger,
                new PresentationTriggerContext(
                    null,
                    motion: new PresentationMotionSnapshot(
                        Vector3.zero,
                        new Vector3(0.2f, 0f, 0f),
                        0.5f,
                        true
                    )
                )
            ),
            Is.True
        );
        Assert.That(
            evaluator.Evaluate(
                trigger,
                new PresentationTriggerContext(
                    null,
                    motion: new PresentationMotionSnapshot(
                        Vector3.zero,
                        new Vector3(0.2f, 0f, 0f),
                        1.0f,
                        true
                    )
                )
            ),
            Is.False
        );
    }

    [Test]
    public void MotionTrigger_RejectsWrongDirectionAndUnknownPreset()
    {
        PresentationTriggerEvaluator evaluator = new PresentationTriggerEvaluator();
        PresentationMotionSnapshot motion = new PresentationMotionSnapshot(
            Vector3.zero,
            new Vector3(0f, 0f, 0.2f),
            0.2f,
            true
        );

        Assert.That(
            evaluator.Evaluate(
                new PresentationTrigger { type = "motion", reference = "swipe_right" },
                new PresentationTriggerContext(null, motion: motion)
            ),
            Is.False
        );
        Assert.That(
            evaluator.Evaluate(
                new PresentationTrigger { type = "motion", reference = "unknown" },
                new PresentationTriggerContext(null, motion: motion)
            ),
            Is.False
        );
    }

    [Test]
    public void RuntimeState_ProcessesMotionTriggerThroughTriggerContext()
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
                            id = "cue_motion",
                            trigger = new PresentationTrigger
                            {
                                type = "motion",
                                reference = "push_forward"
                            }
                        }
                    }
                }
            }
        };
        PresentationData presentation = new PresentationData { groups = new[] { group } };
        PresentationRuntimeState state = new PresentationRuntimeState();
        state.Reset(presentation);

        Assert.That(
            state.TryProcessTrigger(
                presentation,
                new PresentationTriggerContext(
                    null,
                    motion: new PresentationMotionSnapshot(
                        Vector3.zero,
                        new Vector3(0f, 0f, 0.2f),
                        0.2f,
                        true
                    )
                ),
                out PresentationCue cue
            ),
            Is.True
        );
        Assert.That(cue.id, Is.EqualTo("cue_motion"));
    }

    [Test]
    public void MotionTracker_AccumulatesWhileHeldAndResetsOnRelease()
    {
        PresentationMotionTracker tracker = new PresentationMotionTracker();
        PresentationMotionSnapshot snapshot;

        Assert.That(
            tracker.TryUpdate(true, Vector3.zero, 0.1f, out snapshot),
            Is.False
        );
        Assert.That(
            tracker.TryUpdate(true, new Vector3(0.2f, 0f, 0f), 0.2f, out snapshot),
            Is.True
        );
        Assert.That(snapshot.Distance, Is.EqualTo(0.2f));
        Assert.That(snapshot.Duration, Is.EqualTo(0.2f));

        Assert.That(
            tracker.TryUpdate(false, new Vector3(0.3f, 0f, 0f), 0.2f, out snapshot),
            Is.False
        );
        Assert.That(
            tracker.TryUpdate(true, new Vector3(0.4f, 0f, 0f), 0.1f, out snapshot),
            Is.False
        );
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
    public void RuntimeState_RejectsUnknownNextStepWithoutConsumingCue()
    {
        PresentationCue cue = new PresentationCue
        {
            id = "cue_01",
            trigger = new PresentationTrigger
            {
                type = "input",
                condition = new TriggerCondition { input = "primary" }
            },
            nextStep = "missing_step"
        };
        PresentationGroup group = new PresentationGroup
        {
            id = "group_01",
            steps = new[]
            {
                new PresentationStep { id = "step_01", cues = new[] { cue } }
            }
        };
        PresentationData presentation = new PresentationData { groups = new[] { group } };
        PresentationRuntimeState state = new PresentationRuntimeState();
        state.Reset(presentation);

        Assert.That(state.TryProcessInput(presentation, "primary", out _), Is.False);
        Assert.That(state.CurrentStepId, Is.EqualTo("step_01"));

        group.steps = new[]
        {
            group.steps[0],
            new PresentationStep { id = "missing_step" }
        };
        Assert.That(state.TryProcessInput(presentation, "primary", out _), Is.True);
        Assert.That(state.CurrentStepId, Is.EqualTo("missing_step"));
    }

    [Test]
    public void RuntimeLogger_EmitsWarningsAndErrorsWhenInfoIsDisabled()
    {
        UnityPresentationRuntimeLogger logger = new UnityPresentationRuntimeLogger(false);
        LogAssert.Expect(LogType.Warning, "[Presentation] warning");
        LogAssert.Expect(LogType.Error, "[Presentation] error");

        logger.Warning("warning");
        logger.Error("error");
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
        Assert.That(
            logger.Messages,
            Has.Some.Contains("Action: setVisible -> element_01 = True")
        );
        Assert.That(
            logger.Messages,
            Has.Some.Contains("Action: setPosition -> element_01")
        );
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
