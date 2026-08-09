using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public sealed class ApiPresentationJsonSource : PresentationJsonSource
{
    [SerializeField] private string url;

    public override IEnumerator Load(Action<string> onLoaded, Action<string> onFailed)
    {
        using UnityWebRequest request = UnityWebRequest.Get(url);
        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            onFailed?.Invoke($"ApiPresentationJsonSource: {request.responseCode} / {request.error}");
            yield break;
        }

        onLoaded?.Invoke(request.downloadHandler.text);
    }
}
