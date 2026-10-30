#if UNITY_ANDROID && !UNITY_EDITOR
using UnityEngine;

public sealed class AndroidQuestCredentialStore : IQuestCredentialStore
{
    private static string Invoke(string method, string scope, string value = null)
    {
        using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
        using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
        using (var storage = new AndroidJavaClass("me.unframe.QuestCredentialStorage"))
        {
            return value == null
                ? storage.CallStatic<string>(method, activity, scope)
                : storage.CallStatic<string>(method, activity, scope, value);
        }
    }

    public QuestAccountCredential Load(string scope)
    {
        string json = Invoke("read", scope);
        return string.IsNullOrEmpty(json) ? null : JsonUtility.FromJson<QuestAccountCredential>(json);
    }

    public void Save(string scope, QuestAccountCredential credential) => Invoke("write", scope, JsonUtility.ToJson(credential));
    public void Delete(string scope) => Invoke("delete", scope);
}
#endif
