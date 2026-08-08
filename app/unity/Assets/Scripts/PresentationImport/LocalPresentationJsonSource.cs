using System;
using System.Collections;
using UnityEngine;

public sealed class LocalPresentationJsonSource : PresentationJsonSource
{
    [SerializeField] private TextAsset jsonFile;
    [SerializeField] private string resourcesPath = "PresentationSamples/LocalSample";

    public override IEnumerator Load(Action<string> onLoaded, Action<string> onFailed)
    {
        TextAsset source = jsonFile;
        if (source == null && !string.IsNullOrEmpty(resourcesPath))
        {
            source = Resources.Load<TextAsset>(resourcesPath);
        }

        if (source == null)
        {
            onFailed?.Invoke($"LocalPresentationJsonSource: JSON not found ({resourcesPath}).");
            yield break;
        }

        onLoaded?.Invoke(source.text);
        yield return null;
    }
}
