using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationMediaStateEditModeTests
{
    [Test]
    public void SnapshotRetainsStoppedMediaAndReliableEventsUpdatePlayback()
    {
        var store = CreateStore(out ControlServerItem snapshot);
        const string surface = "semantic-surface:text-greeting";
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.MediaStates.Add(new MediaRuntimeState
        { SurfaceId = surface, Stopped = new MediaStoppedState { HeldPositionMs = 25 } });
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        Assert.That(store.TryGetMediaState(surface, out MediaRuntimeState media), Is.True);
        Assert.That(media.Stopped.HeldPositionMs, Is.EqualTo(25));
        var run = new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 91 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:media", CauseEventId = "event:media" },
            Completion = RunCompletion.NonBlocking,
            Media = new MediaRunSnapshot
            {
                SurfaceId = surface,
                Playback = new PlaybackClock
                { Playing = new PlayingClock { PositionAtReferenceMs = 25 } }
            },
        };
        Assert.That(store.TryReceiveControl(Event(snapshot, 1, new ProjectedReliableEvent
        { MediaStarted = new MediaStarted { SurfaceId = surface, RunId = run.RunId.Clone(), Run = run, Playback = run.Media.Playback.Clone() } }), out error), Is.True, error);
        Assert.That(store.TryGetMediaState(surface, out media), Is.True);
        Assert.That(media.Active.RunId, Is.EqualTo(run.RunId));
        run = run.Clone();
        run.Media.Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 250 } };
        Assert.That(store.TryReceiveControl(Event(snapshot, 2, new ProjectedReliableEvent
        { MediaPaused = new MediaPaused { SurfaceId = surface, RunId = run.RunId.Clone(), Run = run, PositionMs = 250 } }), out error), Is.True, error);
        Assert.That(store.TryGetMediaState(surface, out media), Is.True);
        Assert.That(media.Active.Playback.Paused.PositionMs, Is.EqualTo(250));
        Assert.That(store.TryReceiveControl(Event(snapshot, 3, new ProjectedReliableEvent
        { MediaStopped = new MediaStopped { SurfaceId = surface, RunId = run.RunId.Clone(), HeldPositionMs = 250 } }), out error), Is.True, error);
        Assert.That(store.TryGetMediaState(surface, out media), Is.True);
        Assert.That(media.Stopped.HeldPositionMs, Is.EqualTo(250));
    }

    [Test]
    public void UnknownMediaRunIsRejectedWithoutMutatingPlayback()
    {
        var store = CreateStore(out ControlServerItem snapshot);
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.MediaStates.Add(new MediaRuntimeState
        { SurfaceId = "semantic-surface:text-greeting", Stopped = new MediaStoppedState() });
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(Event(snapshot, 1, new ProjectedReliableEvent
        { MediaStopped = new MediaStopped { SurfaceId = "semantic-surface:text-greeting", RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 99 } } }), out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    private static ControlServerItem Event(ControlServerItem snapshot, ulong sequence, ProjectedReliableEvent payload)
    {
        payload.Fence = snapshot.ConnectionSnapshot.Fence.Clone();
        payload.Sequence = sequence;
        return new ControlServerItem { ReliableEvent = payload };
    }

    private static PresentationRuntimeDataStore CreateStore(out ControlServerItem snapshot)
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out DeliveryManifest manifest, out string error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
            out snapshot, out error), Is.True, error);
        foreach (var surface in manifest.ProjectionProfile.RuntimeCatalog.Surfaces)
            if (surface.SurfaceId == "semantic-surface:text-greeting")
            {
                surface.HasVideo = true;
                surface.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
            }
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out error), Is.True, error);
        return store;
    }
}
