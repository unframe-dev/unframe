using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationPreviewSpatialEditModeTests
{
    private const string Valid = "{\"requestId\":\"request\",\"sequence\":\"1\",\"presenterPosition\":[2,1,3],\"presenterRotation\":[0,0.7071067811865475,0,0.7071067811865476],\"zones\":[{\"zoneId\":\"stage\",\"center\":[4,1,6],\"active\":true,\"inside\":false}]}";

    [Test]
    public void SpatialInputValidatesTheWholeShapeBeforeChangingTheScene()
    {
        Assert.That(PresentationPreviewSpatialState.TryParse(Valid, out var state), Is.True);
        Assert.That(state.PresenterPosition, Is.EqualTo(new Vector3(2, 1, -3)));
        Assert.That(Quaternion.Angle(state.PresenterRotation, Quaternion.Euler(0, -90, 0)), Is.LessThan(0.001f));
        Assert.That(PresentationPreviewSpatialState.TryParse(Valid.Replace("[0,0.7071067811865475,0,0.7071067811865476]", "[0,0,0,0]"), out _), Is.False);
        Assert.That(state.Zones[0].Center, Is.EqualTo(new Vector3(4, 1, -6)));
        Assert.That(PresentationPreviewSpatialState.TryParse(Valid.Replace("[2,1,3]", "[2,1]"), out _), Is.False);
        Assert.That(PresentationPreviewSpatialState.TryParse(Valid.Replace("\"1\"", "\"01\""), out _), Is.False);
        Assert.That(PresentationPreviewSpatialState.TryParse(Valid.Replace("\"inside\":false", "\"inside\":false,\"extra\":1"), out _), Is.False);
        Assert.That(PresentationPreviewSpatialState.TryParse(Valid.Replace("[2,1,3]", "[2,1,1e100]"), out _), Is.False);
    }

    [Test]
    public void SpatialGuidesUsePresentationCoordinatesAndOnlyAppearInOverheadView()
    {
        var root = new GameObject("spatial");
        try
        {
            using var guides = new PresentationPreviewSpatial(root.transform);
            PresentationPreviewSpatialState.TryParse(Valid, out var state);
            guides.Apply(state);
            Assert.That(guides.Root.activeSelf, Is.False);
            guides.SetVisible(true);
            Assert.That(guides.Root.activeSelf, Is.True);
            Transform presenter = guides.Root.transform.Find("Presenter");
            Assert.That(presenter.localPosition, Is.EqualTo(new Vector3(2, 1, -3)));
            Assert.That(presenter.GetComponent<Collider>(), Is.Null);
            Mesh marker = presenter.GetComponent<MeshFilter>().sharedMesh;
            Assert.That(marker.bounds.size.y, Is.Zero, "The overhead marker is a mesh in the XZ plane, without a physics primitive dependency.");
            Assert.That(marker.bounds.size.x, Is.GreaterThan(0));
            Assert.That(marker.bounds.size.z, Is.GreaterThan(0));
            Assert.That(guides.Root.transform.Find("Zone stage").localPosition, Is.EqualTo(new Vector3(4, 1, -6)));
            Assert.That(guides.Root.transform.Find("AprilTag origin").localPosition, Is.EqualTo(Vector3.zero));
            Assert.That(guides.TagTexture.GetPixel(0, 0), Is.EqualTo(Color.white));
            Assert.That(guides.TagTexture.GetPixel(2, 2), Is.EqualTo(Color.black));
            guides.Clear();
            Assert.That(guides.Root.activeSelf, Is.False);
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void OverheadViewRestoresThePreviousPerspectivePose()
    {
        var root = new GameObject("camera");
        try
        {
            var camera = root.AddComponent<Camera>();
            var controls = root.AddComponent<PresentationPreviewCamera>();
            controls.Frame(null);
            Vector3 position = root.transform.position;
            Quaternion rotation = root.transform.rotation;
            controls.SetSpatialBounds(new Bounds(new Vector3(2, 0, -3), new Vector3(8, 4, 6)));
            controls.SetView("overhead");
            Assert.That(camera.orthographic, Is.True);
            Assert.That(Vector3.Dot(root.transform.forward, Vector3.down), Is.GreaterThan(0.999f));
            controls.SetView("perspective");
            Assert.That(camera.orthographic, Is.False);
            Assert.That(root.transform.position, Is.EqualTo(position));
            Assert.That(Quaternion.Angle(root.transform.rotation, rotation), Is.LessThan(0.001f));
        }
        finally { Object.DestroyImmediate(root); }
    }
}
