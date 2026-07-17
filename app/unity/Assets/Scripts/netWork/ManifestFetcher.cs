using UnityEngine;

public class ManifestFetcher : MonoBehaviour
{
    [SerializeField] private TextAsset manifestJsonFile;
    [SerializeField] private PresentationBuilder presentationBuilder;

    void Start()
    {
        BuildFromLocalJson();
    }

    public void BuildFromLocalJson()
    {
        if (manifestJsonFile == null)
        {
            Debug.LogError("ManifestFetcher: manifestJsonFile is not assigned");
            return;
        }

        if (presentationBuilder == null)
        {
            Debug.LogError("ManifestFetcher: presentationBuilder is not assigned");
            return;
        }

        string json = manifestJsonFile.text;
        Debug.Log($"Local Manifest JSON:\n{json}");

        presentationBuilder.BuildFromJson(json);
    }
}
