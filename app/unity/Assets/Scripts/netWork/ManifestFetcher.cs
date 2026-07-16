using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public class ManifestFetcher : MonoBehaviour
{
    [SerializeField] private string baseUrl = "https://your-worker-url.workers.dev";
    [SerializeField] private string presentationId = "p0000000-0000-4000-8000-000000000001";
    [SerializeField] private PresentationBuilder presentationBuilder;

    void Start()
    {
        StartCoroutine(GetManifest());
    }

    private IEnumerator GetManifest()
    {
        string url = $"{baseUrl}/presentations/{presentationId}/manifest";

        Debug.Log($"Request URL: {url}");

        using UnityWebRequest request = UnityWebRequest.Get(url);
        request.timeout = 10;

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            Debug.LogError($"Manifest request failed: {request.responseCode} / {request.error}");
            Debug.LogError(request.downloadHandler.text);
            yield break;
        }

        string json = request.downloadHandler.text;
        Debug.Log($"Manifest JSON:\n{json}");

        if (presentationBuilder == null)
        {
            Debug.LogError("ManifestFetcher: presentationBuilder is not assigned");
            yield break;
        }

        presentationBuilder.BuildFromJson(json);
    }
}
