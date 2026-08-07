using System;

[Serializable]
public sealed class PresentationDocument
{
    public string schemaVersion;
    public PresentationData presentation;
}

[Serializable]
public sealed class PresentationData
{
    public string id;
    public string title;
    public PresentationStage stage;
    public PresentationAsset[] assets;
    public PresentationGroup[] groups;
}

[Serializable]
public sealed class PresentationStage
{
    public Vector3Data size;
    public CoordinateSystemData coordinateSystem;
    public PresentationZone[] zones;
}

[Serializable]
public sealed class CoordinateSystemData
{
    public string unit;
    public string upAxis;
    public string horizontalAxis;
    public string audienceDirection;
}

[Serializable]
public sealed class PresentationZone
{
    public string id;
    public float[] min;
    public float[] max;
}

[Serializable]
public sealed class PresentationAsset
{
    public string id;
    public string type;
    public string src;
}

[Serializable]
public sealed class PresentationGroup
{
    public string id;
    public string name;
    public PresentationTrigger trigger;
    public PresentationElement[] elements;
    public PresentationDynamicGroup[] dynamicGroups;
    public PresentationStep[] steps;
}

[Serializable]
public sealed class PresentationDynamicGroup
{
    public string id;
    public DynamicAnchor anchor;
    public TransformData transform;
    public PresentationElement[] elements;
}

[Serializable]
public sealed class DynamicAnchor
{
    public string target;
    public bool followPosition;
    public bool followRotation;
}

[Serializable]
public sealed class PresentationStep
{
    public string id;
    public PresentationCue[] cues;
}

[Serializable]
public sealed class PresentationCue
{
    public string id;
    public PresentationTrigger trigger;
    public PresentationAction[] actions;
    public string nextStep;
}

[Serializable]
public sealed class PresentationTrigger
{
    public string type;
    public string target;
    public string reference;
    public TriggerCondition condition;
}

[Serializable]
public sealed class TriggerCondition
{
    public string type;
    public string fromZone;
    public string toZone;
    public string zoneId;
    public string input;
    public string state;
    public float[] direction;
    public float minimumDistance;
    public float maximumDuration;
    public float minimumSpeed;
}

[Serializable]
public sealed class PresentationAction
{
    public string targetId;
    public string type;
    public float[] vectorValue;
    public string stringValue;
    public PresentationTransition transition;
}

[Serializable]
public sealed class PresentationTransition
{
    public float duration;
    public float delay;
    public string easing;
}

[Serializable]
public sealed class PresentationElement
{
    public string id;
    public string type;
    public string assetId;
    public ElementContent content;
    public ElementInitialState initialState;
}

[Serializable]
public sealed class ElementContent
{
    public string assetId;
    public string text;
    public string fontFamily;
    public float fontSize;
    public int fontWeight;
    public string alignment;
    public float[] color;
    public float maxWidth;
    public string billboard;
    public ElementSize size;
    public string fit;
    public bool preserveAspectRatio;
    public ElementPlayback playback;
    public ElementAnimation animation;
    public ElementRendering rendering;
    public ElementSpatial spatial;
    public string shape;
    public ElementFill fill;
    public ElementBorder border;
}

[Serializable]
public sealed class ElementSize
{
    public float width;
    public float height;
}

[Serializable]
public sealed class ElementPlayback
{
    public bool autoplay;
    public bool loop;
    public float startTime;
    public float volume = 1f;
}

[Serializable]
public sealed class ElementAnimation
{
    public bool playOnStart;
    public string defaultClip;
}

[Serializable]
public sealed class ElementRendering
{
    public bool castShadow = true;
    public bool receiveShadow = true;
}

[Serializable]
public sealed class ElementSpatial
{
    public bool enabled;
    public float minDistance = 1f;
    public float maxDistance = 10f;
}

[Serializable]
public sealed class ElementFill
{
    public float[] color;
}

[Serializable]
public sealed class ElementBorder
{
    public bool enabled;
    public float[] color;
    public float width;
}

[Serializable]
public sealed class ElementInitialState
{
    public bool active;
    public bool visible;
    public float opacity = 1f;
    public TransformData transform;

    public bool ResolveActive()
    {
        return active || visible;
    }
}

[Serializable]
public sealed class TransformData
{
    public float[] position;
    public float[] rotation;
    public float[] scale;
}

[Serializable]
public sealed class Vector3Data
{
    public float width;
    public float height;
    public float depth;
}
