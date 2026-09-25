using System;
using Unframe.Realtime.V2;
using Unframe.Delivery.V2;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Local protobuf-JSON fixture entry point for Delivery ingestion and reliable-event playback.
    /// </summary>
    public sealed class LocalPresentationFixtureRunner : MonoBehaviour
    {
        [SerializeField] private TextAsset deliveryFixture;
        [SerializeField] private TextAsset snapshotFixture;
        [SerializeField] private TextAsset[] reliableEventFixtures;
        [SerializeField] private Transform hierarchyRoot;
        [SerializeField] private PresentationAnimationPresetLibrary animationPresetLibrary;

        public PresentationRuntimeDataStore Store { get; } = new PresentationRuntimeDataStore();
        public PresentationNodeHierarchy Hierarchy { get; } = new PresentationNodeHierarchy();
        public bool HasLoadedFixture { get; private set; }
        public int AppliedEventCount { get; private set; }
        public int ReliableEventCount { get { return ResolveReliableEventFixtures().Length; } }
        public bool IsAnimating { get { return timelinePlayer.ActiveCount > 0; } }
        public bool CanAdvance { get { return HasLoadedFixture && AppliedEventCount < ReliableEventCount && timelinePlayer.ActiveCount == 0; } }

        private readonly PresentationNodeStateApplier stateApplier = new PresentationNodeStateApplier();
        private readonly LocalPresentationPlaceholderRenderer placeholderRenderer = new LocalPresentationPlaceholderRenderer();
        private readonly PresentationTimelinePlayer timelinePlayer = new PresentationTimelinePlayer();

        public void SetDeliveryFixture(TextAsset fixture)
        {
            deliveryFixture = fixture;
        }

        public void SetSnapshotFixture(TextAsset fixture)
        {
            snapshotFixture = fixture;
        }

        public void SetReliableEventFixtures(TextAsset[] fixtures)
        {
            reliableEventFixtures = fixtures;
        }

        public void SetAnimationPresetLibrary(PresentationAnimationPresetLibrary library)
        {
            animationPresetLibrary = library;
        }

        [ContextMenu("Load Local Delivery Fixture")]
        public void LoadFromContextMenu()
        {
            if (!TryLoad(out string error))
            {
                Debug.LogError("[Presentation] " + error, this);
            }
        }

        [ContextMenu("Clear Local Delivery Fixture")]
        public void Clear()
        {
            timelinePlayer.Clear();
            placeholderRenderer.Clear();
            Hierarchy.Clear();
            HasLoadedFixture = false;
            AppliedEventCount = 0;
        }

        [ContextMenu("Advance Local Reliable Event")]
        public void AdvanceFromContextMenu()
        {
            if (!TryAdvance(out string error))
            {
                Debug.LogError("[Presentation] " + error, this);
            }
        }

        public bool TryLoad(out string error)
        {
            Clear();
            TextAsset fixture = deliveryFixture != null
                ? deliveryFixture
                : Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery");
            if (fixture == null)
            {
                error = "A local Delivery fixture is required.";
                return false;
            }

            if (!PresentationContractJsonFixtureLoader.TryParseDelivery(fixture.text, out DeliveryManifest manifest, out error))
            {
                return false;
            }

            if (!Store.TryReceiveDelivery(manifest, out error))
            {
                return false;
            }

            if (!Hierarchy.TryReplace(Store, hierarchyRoot != null ? hierarchyRoot : transform, out error))
            {
                return false;
            }

            TextAsset snapshot = snapshotFixture != null
                ? snapshotFixture
                : Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot");
            if (snapshot == null)
            {
                error = "A local connection snapshot fixture is required.";
                return false;
            }

            if (!PresentationContractJsonFixtureLoader.TryParseControlItem(snapshot.text, out ControlServerItem item, out error)
                || !Store.TryReceiveControl(item, out error))
            {
                return false;
            }

            placeholderRenderer.Render(Store, Hierarchy);
            stateApplier.Apply(Store, Hierarchy);
            HasLoadedFixture = true;
            return true;
        }

        public bool TryAdvance(out string error)
        {
            if (!HasLoadedFixture)
            {
                error = "Load Local Presentation before advancing the local presentation.";
                return false;
            }

            if (timelinePlayer.ActiveCount > 0)
            {
                error = "Wait for the current local animation to finish before advancing.";
                return false;
            }

            TextAsset[] fixtures = ResolveReliableEventFixtures();
            if (AppliedEventCount >= fixtures.Length)
            {
                error = "No local reliable event remains.";
                return false;
            }

            if (!PresentationContractJsonFixtureLoader.TryParseControlItem(fixtures[AppliedEventCount].text, out ControlServerItem item, out error)
                || !Store.TryReceiveControl(item, out error))
            {
                return false;
            }

            ApplyControlToVisuals(item);
            if (!TryApplyTimelineEvent(item, out error))
            {
                return false;
            }

            AppliedEventCount++;
            return true;
        }

        private void ApplyControlToVisuals(ControlServerItem item)
        {
            if (item.ItemCase != ControlServerItem.ItemOneofCase.ReliableEvent)
            {
                return;
            }

            switch (item.ReliableEvent.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.NodeStateCommitted:
                    stateApplier.ApplyNodeState(Store, Hierarchy, item.ReliableEvent.NodeStateCommitted.State.NodeId);
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.SurfaceStateChanged:
                    placeholderRenderer.RefreshSurfaces(Store);
                    break;
            }
        }

        private TextAsset[] ResolveReliableEventFixtures()
        {
            TextAsset[] fixtures = reliableEventFixtures != null && reliableEventFixtures.Length > 0
                ? reliableEventFixtures
                : Resources.LoadAll<TextAsset>("PresentationFixtures/Control");
            Array.Sort(fixtures, (left, right) => String.CompareOrdinal(left.name, right.name));
            return fixtures;
        }

        private bool TryApplyTimelineEvent(ControlServerItem item, out string error)
        {
            error = null;
            if (item.ItemCase != ControlServerItem.ItemOneofCase.ReliableEvent)
            {
                return true;
            }

            ProjectedReliableEvent reliableEvent = item.ReliableEvent;
            switch (reliableEvent.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.TimelineStarted:
                    string timelineId = reliableEvent.TimelineStarted.TimelineId;
                    if (animationPresetLibrary != null && timelineId.StartsWith("preset:", StringComparison.Ordinal) && !animationPresetLibrary.Contains(timelineId))
                    {
                        error = "timeline preset id is not registered in the assigned library.";
                        return false;
                    }

                    if (!Store.TryGetTimeline(timelineId, out Unframe.Presentation.V2.ProjectedTimelineDefinition timeline)
                        || !timelinePlayer.TryStart(timeline, Hierarchy, Time.realtimeSinceStartupAsDouble, out error))
                    {
                        return false;
                    }

                    if (!Application.isPlaying)
                    {
                        timelinePlayer.Update(Time.realtimeSinceStartupAsDouble + timeline.DurationMs / 1000d);
                    }

                    return true;
                case ProjectedReliableEvent.PayloadOneofCase.TimelineCompleted:
                    timelinePlayer.Complete(reliableEvent.TimelineCompleted.TimelineId);
                    return true;
                case ProjectedReliableEvent.PayloadOneofCase.TimelineCanceled:
                    timelinePlayer.Stop(reliableEvent.TimelineCanceled.TimelineId);
                    return true;
                default:
                    return true;
            }
        }

        private void Update()
        {
            if (Application.isPlaying)
            {
                timelinePlayer.Update(Time.realtimeSinceStartupAsDouble);
                Keyboard keyboard = Keyboard.current;
                if (keyboard != null && (keyboard.spaceKey.wasPressedThisFrame || keyboard.enterKey.wasPressedThisFrame) && CanAdvance)
                {
                    if (!TryAdvance(out string error))
                    {
                        Debug.LogError("[Presentation] " + error, this);
                    }
                }
            }
        }

        private void OnDestroy()
        {
            Clear();
        }
    }
}
