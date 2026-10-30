using System;

[Serializable]
public sealed class QuestAccountCredential
{
    public string token;
    public long expiresAt;

    public QuestAccountCredential(string token, DateTimeOffset expiresAt)
    {
        this.token = token;
        this.expiresAt = expiresAt.ToUnixTimeSeconds();
    }
}

public interface IQuestCredentialStore
{
    QuestAccountCredential Load(string scope);
    void Save(string scope, QuestAccountCredential credential);
    void Delete(string scope);
}

public static class QuestCredentialStores
{
    public static IQuestCredentialStore Create()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        return new AndroidQuestCredentialStore();
#else
        return null;
#endif
    }
}
