using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public class BackendRequestTest : MonoBehaviour
{
    [SerializeField] private string baseUrl = "https://unframe-backend-preview.unframe-dev.workers.dev";

    void Start()
    {
        StartCoroutine(GetHealth());
    }

    private IEnumerator GetHealth()
    {
        string url = $"{baseUrl}/health";

        using UnityWebRequest request = UnityWebRequest.Get(url);
        request.timeout = 10;

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            Debug.LogError($"Request failed: {request.responseCode} / {request.error} / {url}");
            yield break;
        }

        Debug.Log($"Response: {request.downloadHandler.text}");
    }
}
