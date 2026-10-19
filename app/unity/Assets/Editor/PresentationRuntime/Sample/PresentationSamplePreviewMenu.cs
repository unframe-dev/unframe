using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime.Editor
{
    [InitializeOnLoad]
    public static class PresentationSamplePreviewMenu
    {
        private const string PendingKey = "Unframe.LocalSample.Pending";
        private const string RestoreKey = "Unframe.LocalSample.RestoreScenes";
        private static string RepositoryRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "../../.."));
        public static string ConnectionPath => Path.Combine(RepositoryRoot, ".unframe/presentation-sample/active-connection.json");
        private static string SceneSetupPath => Path.Combine(Path.GetDirectoryName(Application.dataPath), "Library/UnframeLocalSample/editor-scenes.json");

        [Serializable]
        private sealed class SceneSetupDocument { public SavedScene[] scenes; }

        [Serializable]
        private sealed class SavedScene
        {
            public string path;
            public bool isLoaded, isActive;
        }

        static PresentationSamplePreviewMenu()
        {
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
        }

        [MenuItem("Unframe/Presentation/Play Local Sample in Editor")]
        public static void PlayLocalSample()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            try
            {
                var settings = PresentationSampleConnectionSettings.Load(ConnectionPath, DateTimeOffset.UtcNow);
                settings.ClearCredential();
            }
            catch (Exception)
            {
                EditorUtility.DisplayDialog("Local Sample", "sample-connection-unavailable\nRun nix run .#presentation-sample first, then use this menu again.", "OK");
                return;
            }
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            // Scene paths are the only persisted state; connection credentials are read after domain reload.
            Directory.CreateDirectory(Path.GetDirectoryName(SceneSetupPath));
            File.WriteAllText(SceneSetupPath, JsonUtility.ToJson(new SceneSetupDocument
            {
                scenes = EditorSceneManager.GetSceneManagerSetup().Select(scene => new SavedScene
                {
                    path = scene.path, isLoaded = scene.isLoaded, isActive = scene.isActive,
                }).ToArray(),
            }));
            SessionState.SetBool(RestoreKey, true);
            SessionState.SetBool(PendingKey, true);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorApplication.isPlaying = true;
        }

        private static void OnPlayModeStateChanged(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.EnteredPlayMode && SessionState.GetBool(PendingKey, false))
            {
                SessionState.SetBool(PendingKey, false);
                try
                {
                    var settings = PresentationSampleConnectionSettings.Load(ConnectionPath, DateTimeOffset.UtcNow);
                    var driver = new GameObject("Unframe Local Sample Preview").AddComponent<PresentationSamplePreviewDriver>();
                    driver.StartPreview(settings);
                }
                catch (Exception)
                {
                    EditorUtility.DisplayDialog("Local Sample", "sample-preview-start-failed", "OK");
                    EditorApplication.isPlaying = false;
                }
            }
            if (state == PlayModeStateChange.EnteredEditMode && SessionState.GetBool(RestoreKey, false))
            {
                SessionState.SetBool(RestoreKey, false);
                SessionState.SetBool(PendingKey, false);
                try
                {
                    var document = JsonUtility.FromJson<SceneSetupDocument>(File.ReadAllText(SceneSetupPath));
                    SceneSetup[] scenes = document?.scenes?.Where(scene => !string.IsNullOrEmpty(scene.path)).Select(scene => new SceneSetup
                    {
                        path = scene.path, isLoaded = scene.isLoaded, isActive = scene.isActive,
                    }).ToArray();
                    if (scenes != null && scenes.Length > 0)
                    {
                        if (!scenes.Any(scene => scene.isActive)) scenes.First(scene => scene.isLoaded).isActive = true;
                        EditorSceneManager.RestoreSceneManagerSetup(scenes);
                    }
                    else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    File.Delete(SceneSetupPath);
                }
                catch (Exception) { EditorUtility.DisplayDialog("Local Sample", "sample-scene-restore-failed", "OK"); }
            }
        }
    }
}
