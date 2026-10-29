using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationMeshClipTests
{
    private static PresentationMeshClip.Vertex Vertex(float x, float y) => new PresentationMeshClip.Vertex(
        new Vector3(x, y), new Vector4(x, y, x * 2, y * 2), new Vector2(x, y), new Color(x, y, 0, 1));
    [Test]
    public void OutsideTriangleProducesNoGlyphGeometry()
    {
        Assert.That(PresentationMeshClip.Triangle(Vertex(2, 2), Vertex(3, 2), Vertex(2, 3), new Rect(0, 0, 1, 1)), Is.Empty);
        Assert.That(PresentationMeshClip.Triangle(Vertex(0, 0), Vertex(1, 0), Vertex(0, 1), new Rect(1, 0, 0, 1)), Is.Empty);
    }
    [Test]
    public void InsideAndBoundaryVerticesRetainEveryTextureChannel()
    {
        var vertices = PresentationMeshClip.Triangle(Vertex(0, 0), Vertex(1, 0), Vertex(0, 1), new Rect(0, 0, 1, 1));
        Assert.That(vertices.Count, Is.EqualTo(3));
        Assert.That(vertices[1].Uv0, Is.EqualTo(new Vector4(1, 0, 2, 0)));
        Assert.That(vertices[2].Uv2, Is.EqualTo(new Vector2(0, 1)));
    }
    [Test]
    public void IntersectionsInterpolateUvsAndColorAtTheSamePosition()
    {
        var vertices = PresentationMeshClip.Triangle(Vertex(0, 0), Vertex(1, 0), Vertex(0, 1), new Rect(.25f, .25f, .5f, .5f));
        Assert.That(vertices.Count, Is.GreaterThanOrEqualTo(3));
        foreach (var vertex in vertices)
        {
            Assert.That(vertex.Position.x, Is.InRange(.24999f, .75001f)); Assert.That(vertex.Position.y, Is.InRange(.24999f, .75001f));
            Assert.That(vertex.Uv0.x, Is.EqualTo(vertex.Position.x).Within(.001f));
            Assert.That(vertex.Uv0.w, Is.EqualTo(vertex.Position.y * 2).Within(.001f));
            Assert.That(vertex.Color.r, Is.EqualTo(vertex.Position.x).Within(.001f));
            Assert.That(vertex.Color.g, Is.EqualTo(vertex.Position.y).Within(.001f));
            Assert.That(vertex.Color.a, Is.EqualTo(1));
        }
    }
}
