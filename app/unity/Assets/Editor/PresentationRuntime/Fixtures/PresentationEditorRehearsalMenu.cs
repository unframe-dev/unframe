using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class PresentationEditorRehearsalMenu
{
    [MenuItem("Unframe/UI/Play Rehearsal in Editor")]
    public static void Play()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        scene.name = "Editor Rehearsal (temporary)";
        var camera = new GameObject("Rehearsal Camera").AddComponent<Camera>();
        camera.tag = "MainCamera";
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.018f, 0.027f, 0.05f);
        camera.nearClipPlane = 0.01f;
        camera.farClipPlane = 100;
        var rehearsal = new GameObject("Editor Rehearsal").AddComponent<PresentationEditorRehearsal>();
        rehearsal.Configure(camera);
        EditorApplication.EnterPlaymode();
    }

    [MenuItem("Unframe/UI/Play Rehearsal in Editor", true)]
    private static bool CanPlay() => !EditorApplication.isPlayingOrWillChangePlaymode && !EditorApplication.isCompiling;
}
