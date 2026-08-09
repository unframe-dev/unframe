using UnityEngine;

public interface IPresentationRuntimeLogger
{
    void Info(string message);

    void Warning(string message);

    void Error(string message);
}

public sealed class UnityPresentationRuntimeLogger : IPresentationRuntimeLogger
{
    public UnityPresentationRuntimeLogger(bool enableInfo)
    {
        InfoEnabled = enableInfo;
    }

    public bool InfoEnabled { get; }

    public void Info(string message)
    {
        if (InfoEnabled)
        {
            Debug.Log($"[Presentation] {message}");
        }
    }

    public void Warning(string message)
    {
        Debug.LogWarning($"[Presentation] {message}");
    }

    public void Error(string message)
    {
        Debug.LogError($"[Presentation] {message}");
    }
}
