using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public sealed class ManifestApiPresentationJsonSource : PresentationJsonSource
{
    [SerializeField] private string baseUrl = "http://localhost:8080";
    [SerializeField] private string presentationId;
    [SerializeField, Min(1)] private int requestTimeoutSeconds = 15;

    public void Configure(string apiBaseUrl, string targetPresentationId)
    {
        baseUrl = apiBaseUrl;
        presentationId = targetPresentationId;
    }

    public override IEnumerator Load(Action<string> onLoaded, Action<string> onFailed)
    {
        if (!ManifestApiEndpoint.TryBuildUrl(baseUrl, presentationId, out string url, out string error))
        {
            onFailed?.Invoke($"[Presentation/API] Configuration failed: {error}");
            yield break;
        }

        float requestStartedAt = Time.realtimeSinceStartup;
        using UnityWebRequest request = UnityWebRequest.Get(url);
        request.timeout = Mathf.Max(1, requestTimeoutSeconds);
        request.SetRequestHeader("Accept", "application/json");
        Debug.Log($"[Presentation/API] Requesting manifest: {url}");
        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            int responseLength = request.downloadHandler?.text?.Length ?? 0;
            int elapsedMilliseconds = Mathf.RoundToInt(
                (Time.realtimeSinceStartup - requestStartedAt) * 1000f
            );
            onFailed?.Invoke(
                $"[Presentation/API] Request failed "
                + $"(HTTP {request.responseCode}, elapsedMs={elapsedMilliseconds}, "
                + $"responseLength={responseLength}): {request.error}"
            );
            yield break;
        }

        if (!SlideManifestPresentationAdapter.TryConvertToJson(
                request.downloadHandler.text,
                out string definitionJson,
                out string conversionError
            ))
        {
            onFailed?.Invoke(
                $"[Presentation/API] Manifest conversion failed: {conversionError}"
            );
            yield break;
        }

        int successElapsedMilliseconds = Mathf.RoundToInt(
            (Time.realtimeSinceStartup - requestStartedAt) * 1000f
        );
        Debug.Log(
            $"[Presentation/API] Manifest received and converted "
            + $"(HTTP {request.responseCode}, elapsedMs={successElapsedMilliseconds}, "
            + $"manifestLength={request.downloadHandler.text.Length}, "
            + $"definitionLength={definitionJson.Length})."
        );
        onLoaded?.Invoke(definitionJson);
    }
}
