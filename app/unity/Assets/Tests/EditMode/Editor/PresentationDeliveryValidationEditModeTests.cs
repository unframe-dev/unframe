using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationDeliveryValidationEditModeTests
{
    [Test]
    public void LocalFixture_HasACompleteDeliveryGraph()
    {
        AssertAccepted(CreateFixture());
    }

    [Test]
    public void Delivery_RejectsMismatchedProfilePublication()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.ProjectionProfile.Key.Publication.PublicationEpoch++;
        AssertRejected(delivery, "projection profile");
    }

    [Test]
    public void Delivery_RejectsMissingCapabilityVersion()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.CapabilityProfile.ContractVersions.Runtime = 0;
        AssertRejected(delivery, "capability");
    }

    [Test]
    public void Delivery_RejectsUnsupportedRequiredRuntimeCapability()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.ProjectionProfile.RequiredRuntimeCapabilities.Add(RuntimeCapability.Tracking);
        AssertRejected(delivery, "capability");
    }

    [Test]
    public void Delivery_RejectsUnknownSemanticSurface()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.ProjectionProfile.RenderSurfaces[0].SemanticSurfaceId = "surface:absent";
        AssertRejected(delivery, "semantic surface");
    }

    [Test]
    public void Delivery_RejectsMissingReachableStateBinding()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.ProjectionProfile.RenderSurfaces[0].StateBindings.Clear();
        AssertRejected(delivery, "state binding");
    }

    [Test]
    public void Delivery_RejectsUnknownArtifactBinding()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.ProjectionProfile.RenderSurfaces[0].StateBindings[0].Artifact.ArtifactId = "artifact:absent";
        AssertRejected(delivery, "artifact");
    }

    [Test]
    public void Delivery_RejectsMissingReferencedModelAsset()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.AssetAccess.Clear();
        AssertRejected(delivery, "asset");
    }

    [Test]
    public void Delivery_RejectsNativeUiFeatureThatPlaceholderCannotRender()
    {
        DeliveryManifest delivery = CreateFixture();
        delivery.ProjectionProfile.RenderSurfaces[0].Artifacts[0].NativeUi.RequiredFeatures.Add(NativeUiFeature.Clip);
        AssertRejected(delivery, "native UI feature");
    }

    [Test]
    public void Delivery_RejectsVariableTextThatPlaceholderCannotRender()
    {
        DeliveryManifest delivery = CreateFixture();
        NativeUiText text = delivery.ProjectionProfile.RenderSurfaces[0].Artifacts[0].NativeUi.Nodes[0].Text;
        text.Value = new NativeTextValue { StringVariable = new StringVariableText { VariableId = "variable:local-title" } };
        AssertRejected(delivery, "native UI text");
    }

    private static DeliveryManifest CreateFixture()
    {
        TextAsset fixture = Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery");
        Assert.That(fixture, Is.Not.Null);
        return JsonParser.Default.Parse<DeliveryManifest>(fixture.text);
    }

    private static void AssertAccepted(DeliveryManifest delivery)
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
    }

    private static void AssertRejected(DeliveryManifest delivery, string reason)
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False);
        Assert.That(error, Does.Contain(reason));
    }
}
