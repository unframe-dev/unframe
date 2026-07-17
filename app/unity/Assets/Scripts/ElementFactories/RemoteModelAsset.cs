using UnityEngine;

public enum RemoteModelLoadStatus
{
    None,
    Pending,
    Downloading,
    Loaded,
    Unsupported,
    Failed
}

public class RemoteModelAsset : MonoBehaviour
{
    public string AssetId { get; private set; }
    public string Url { get; private set; }
    public string Filename { get; private set; }
    public string MimeType { get; private set; }
    public string LocalPath { get; private set; }
    public string Error { get; private set; }
    public RemoteModelLoadStatus Status { get; private set; } = RemoteModelLoadStatus.None;

    public void MarkPending(ManifestAsset asset)
    {
        AssetId = asset?.assetId;
        Url = asset?.url;
        Filename = asset?.filename;
        MimeType = asset?.mimeType;
        LocalPath = null;
        Error = null;
        Status = RemoteModelLoadStatus.Pending;
    }

    public void MarkDownloading()
    {
        Error = null;
        Status = RemoteModelLoadStatus.Downloading;
    }

    public void MarkLoaded(string localPath)
    {
        LocalPath = localPath;
        Error = null;
        Status = RemoteModelLoadStatus.Loaded;
    }

    public void MarkUnsupported(string error)
    {
        Error = error;
        Status = RemoteModelLoadStatus.Unsupported;
    }

    public void MarkFailed(string error)
    {
        Error = error;
        Status = RemoteModelLoadStatus.Failed;
    }
}
