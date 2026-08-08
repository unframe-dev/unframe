using UnityEngine;

public interface IPresentationRuntimeLogger
{
    void Info(string message);

    void Warning(string message);

    void Error(string message);
}

public sealed class UnityPresentationRuntimeLogger : IPresentationRuntimeLogger
{
    public UnityPresentationRuntimeLogger(bool enabled)
    {
        Enabled = enabled;
    }

    public bool Enabled { get; }

    public void Info(string message)
    {
        if (Enabled)
        {
            Debug.Log($"[Presentation] {message}");
        }
    }

    public void Warning(string message)
    {
        if (Enabled)
        {
            Debug.LogWarning($"[Presentation] {message}");
        }
    }

    public void Error(string message)
    {
        if (Enabled)
        {
            Debug.LogError($"[Presentation] {message}");
        }
    }
}
