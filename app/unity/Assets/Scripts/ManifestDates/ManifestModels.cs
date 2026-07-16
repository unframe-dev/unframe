using System;
using System.Collections.Generic;

[Serializable]
public class ManifestResponse
{
    public string presentationId;
    public string title;
    public List<ManifestSlide> slides;
    public string updatedAt;
}

[Serializable]
public class ManifestSlide
{
    public string id;
    public int orderIndex;
    public List<ManifestElement> elements;
}

[Serializable]
public class ManifestElement
{
    public string type;
    public string id;
    public ManifestTransform transform;

    // text用
    public string text;

    // model / image用
    public ManifestAsset asset;
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
}

[Serializable]
public class ManifestVector3
{
    public float x;
    public float y;
    public float z;
}