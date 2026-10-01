using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

public sealed class PassthroughCameraBuildAssetExclusion : IPreprocessBuildWithReport
{
    internal const string SettingsPath = "Assets/Resources/DevAgentSettings.asset";
    internal static AssetFileExclusion ActiveExclusion;

    // Run before Meta's processor injects local connection credentials into this resource.
    public int callbackOrder => int.MinValue;

    public void OnPreprocessBuild(BuildReport report)
    {
        if (ActiveExclusion == null) return;
        ActiveExclusion.Exclude();
        AssetDatabase.Refresh();
        UnityEngine.Debug.Log("[PCA Preview] Local DevAgent settings excluded from APK.");
    }

    internal sealed class AssetFileExclusion : IDisposable
    {
        private readonly string assetPath;
        private readonly string backupDirectory;
        private readonly List<string> moved = new List<string>();

        internal AssetFileExclusion(string assetPath, string backupDirectory)
        {
            this.assetPath = assetPath;
            this.backupDirectory = backupDirectory;
        }

        internal void Exclude()
        {
            Directory.CreateDirectory(backupDirectory);
            foreach (string path in new[] { assetPath, assetPath + ".meta" })
            {
                if (!File.Exists(path)) continue;
                File.Move(path, Path.Combine(backupDirectory, Path.GetFileName(path)));
                moved.Add(path);
            }
        }

        public void Dispose()
        {
            foreach (string path in moved)
            {
                File.Move(Path.Combine(backupDirectory, Path.GetFileName(path)), path);
            }
            moved.Clear();
            if (Directory.Exists(backupDirectory)) Directory.Delete(backupDirectory);
        }
    }
}
