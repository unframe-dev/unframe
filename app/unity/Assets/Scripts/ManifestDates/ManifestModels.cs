using System;
using System.Collections.Generic;

[Serializable]
public class ManifestResponse
{
    public string id;
    public string presentationId;
    public string title;
    public string thumbnailUrl;
    public ManifestCircularView circularView;
    public List<ManifestSlide> slides;
    public string createdAt;
    public string updatedAt;
}

[Serializable]
public class ManifestSlide
{
    public string id;
    public int orderIndex;
    public ManifestSlideContent content;
    public List<ManifestElement> elements;
}

[Serializable]
public class ManifestSlideContent
{
    public string background;
    public string notes;
    public List<ManifestElement> elements;
}

[Serializable]
public class ManifestElement
{
    public string type;
    public string id;
    public ManifestTransform transform;
    public ManifestElementAnimation animation;

    // text用
    public string text;
    public float fontSize;
    public string fontColor;
    public string textAlign;
    public string fontFamily;
    public string fontWeight;

    // model / image用
    public ManifestAsset asset;

    // model用
    public string assetId;
    public string displayName;
    public string src;

    // shape用
    public string shape;
    public string fillColor;
    public string strokeColor;
    public float strokeWidth;
}

[Serializable]
public class ManifestElementAnimation
{
    public string type;
    public float duration;
    public float delay;
}

[Serializable]
public class ManifestAsset
{
    public string assetId;
    public string url;
    public string filename;
    public string mimeType;
    public long sizeBytes;
}

[Serializable]
public class ManifestTransform
{
    public ManifestVector3 position;
    public ManifestVector3 rotation;
    public ManifestVector3 scale;
    public ManifestCircularPlacement circular;
}

[Serializable]
public class ManifestCircularPlacement
{
    public bool enabled;
    public ManifestVector3 startPosition;
    public ManifestVector3 viewpointPosition;
    public float radius;
    public float angle;
    public bool faceCenter;
}

[Serializable]
public class ManifestCircularView
{
    public bool enabled;
    public ManifestVector3 startPosition;
    public ManifestVector3 viewpointPosition;
    public float radius;
    public float startAngle;
    public float angleStep;
    public List<float> radiusOffsets;
    public List<float> verticalOffsets;
    public bool faceViewpoint;
}

[Serializable]
public class ManifestVector3
{
    public float x;
    public float y;
    public float z;
}
