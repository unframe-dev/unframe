using System;
using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.VisualEffects.Gestures;
using ProtoVector = Unframe.Presentation.Vector3;
using UnityVector = UnityEngine.Vector3;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresenterGesturePositionSample
    {
        private readonly InputContext context;
        public InputContext Context => context.Clone();
        public GesturePositionSample Sample { get; }

        internal PresenterGesturePositionSample(InputContext context, GesturePositionSample sample)
        {
            this.context = context.Clone();
            Sample = sample;
        }
    }

    public sealed class QuestGestureRecognition
    {
        private static readonly GestureKind[] PositionGestureKinds = { GestureKind.Throw, GestureKind.Circle };
        private static readonly GestureHand[] PositionHands = { GestureHand.Left, GestureHand.Right };
        private readonly GesturePositionSampler positionSampler = new GesturePositionSampler();
        public event Action<PresenterGesturePositionSample> PositionSampleReady;
        public double PositionSampleIntervalSeconds
        {
            get => positionSampler.IntervalSeconds;
            set => positionSampler.IntervalSeconds = value;
        }
        private readonly PresenterRecognition legacy = new PresenterRecognition();
        private readonly List<VisualGestureRecognizer> candidates = new List<VisualGestureRecognizer>();
        private InputContext context;
        private PresenterRecognitionCatalog catalog;
        private InputContext capturedContext;
        private PresenterRecognitionResult deferred;
        private bool previousLeft, previousRight, capturedLeft;

        public void Reset(InputContext nextContext, PresenterRecognitionCatalog nextCatalog)
        {
            positionSampler.Reset();
            Cancel();
            context = nextContext?.Clone();
            catalog = nextCatalog?.Clone();
            legacy.Reset(nextContext, nextCatalog);
        }

        private void Cancel()
        {
            foreach (var candidate in candidates) candidate.Cancel();
            candidates.Clear();
            capturedContext = null;
            deferred = null;
        }

        public PresenterRecognitionResult SampleHands(double time, ProtoVector left, ProtoVector right, ProtoVector headForward,
            bool leftTrigger, bool rightTrigger, ProtoVector headPosition)
        {
            SamplePositions(time, left, right, headPosition, headForward);
            bool pressed = leftTrigger && !previousLeft || rightTrigger && !previousRight;
            previousLeft = leftTrigger;
            previousRight = rightTrigger;
            if (pressed)
            {
                Cancel();
                if (context != null && catalog != null && leftTrigger != rightTrigger && headPosition != null && headForward != null)
                {
                    capturedLeft = leftTrigger;
                    var sample = Sample(time, capturedLeft ? left : right, headPosition, headForward);
                    foreach (var kind in new[] { GestureKind.Throw, GestureKind.Circle })
                        if (catalog.Gestures.Contains(kind))
                        {
                            var candidate = new VisualGestureRecognizer();
                            if (candidate.Begin(kind == GestureKind.Throw ? VisualGesture.Throw : VisualGesture.Circle,
                                capturedLeft ? GestureHand.Left : GestureHand.Right, sample)) candidates.Add(candidate);
                        }
                    if (candidates.Count > 0) capturedContext = context.Clone();
                }
            }
            var old = legacy.SampleHands(time, left, right, headForward, leftTrigger, rightTrigger);
            if (capturedContext == null) return old;
            if (pressed) return null;
            ProtoVector hand = capturedLeft ? left : right;
            if (hand == null || headPosition == null || headForward == null)
            {
                Cancel();
                return null;
            }
            if (!(capturedLeft ? leftTrigger : rightTrigger))
            {
                var result = deferred;
                Cancel();
                return result;
            }
            foreach (var candidate in candidates)
            {
                var recognized = candidate.Update(Sample(time, hand, headPosition, headForward));
                if (recognized == null) continue;
                var result = new PresenterRecognitionResult
                {
                    Context = capturedContext.Clone(),
                    Gesture = recognized.Kind == VisualGesture.Throw ? GestureKind.Throw : GestureKind.Circle,
                };
                Cancel();
                // A competing swipe must not escape later from the same held trigger.
                legacy.Reset(context, catalog);
                return result;
            }
            if (old != null) deferred = old;
            bool active = false;
            foreach (var candidate in candidates) active |= candidate.IsCapturing;
            if (!active)
            {
                var result = deferred;
                Cancel();
                return result;
            }
            return null;
        }

        public List<PresenterRecognitionResult> SampleHead(ProtoVector headPosition) => legacy.SampleHead(headPosition);

        private void SamplePositions(double time, ProtoVector left, ProtoVector right, ProtoVector head, ProtoVector forward)
        {
            if (PositionSampleReady == null || context == null || catalog == null) { positionSampler.Reset(); return; }
            foreach (var kind in PositionGestureKinds)
            {
                if (!catalog.Gestures.Contains(kind)) continue;
                var gesture = kind == GestureKind.Throw ? VisualGesture.Throw : VisualGesture.Circle;
                foreach (var hand in PositionHands)
                {
                    var sample = positionSampler.Sample(gesture, hand, Sample(time, hand == GestureHand.Left ? left : right, head, forward));
                    if (sample.HasValue) PositionSampleReady?.Invoke(new PresenterGesturePositionSample(context, sample.Value));
                }
            }
        }

        private static GestureSample Sample(double time, ProtoVector hand, ProtoVector head, ProtoVector forward) =>
            new GestureSample(time, ToUnity(hand), ToUnity(head), ToUnity(forward), hand != null && head != null && forward != null);
        private static UnityVector ToUnity(ProtoVector value) => value == null ? UnityVector.zero
            : new UnityVector((float)value.X, (float)value.Y, -(float)value.Z);
    }
}
