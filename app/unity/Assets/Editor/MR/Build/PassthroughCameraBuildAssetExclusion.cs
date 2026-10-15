using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

public sealed class PassthroughCameraBuildAssetExclusion : IPreprocessBuildWithReport
{
    internal const string SettingsPath = "Assets/Resources/DevAgentSettings.asset";
    internal static AssetFileExclusion ActiveExclusion;

    internal static BuildReport BuildWithoutLocalSettings(Func<BuildReport> build)
    {
        if (build == null) throw new ArgumentNullException(nameof(build));
        if (ActiveExclusion != null) throw new InvalidOperationException("A scoped build exclusion is already active.");
        var preloaded = PlayerSettings.GetPreloadedAssets();
        var preloadedPaths = preloaded.Select(AssetDatabase.GetAssetPath).ToArray();
        var preloadedIds = preloaded.Select(GlobalObjectId.GetGlobalObjectIdSlow).ToArray();
        var exclusion = new AssetFileExclusion(SettingsPath,
            Path.Combine("Library", "PcaBuildBackup", Guid.NewGuid().ToString("N")));
        try
        {
            ActiveExclusion = exclusion;
            PlayerSettings.SetPreloadedAssets(preloaded.Where((asset, index) => preloadedPaths[index] != SettingsPath).ToArray());
            return build();
        }
        finally
        {
            ActiveExclusion = null;
            try
            {
                exclusion.Dispose();
            }
            finally
            {
                try
                {
                    AssetDatabase.Refresh();
                }
                finally
                {
                    PlayerSettings.SetPreloadedAssets(preloadedIds.Select(GlobalObjectId.GlobalObjectIdentifierToObjectSlow).ToArray());
                }
            }
        }
    }

    internal static void ValidateBuildPolicy(BuildTarget target, bool settingsExist, bool exclusionActive)
    {
        if (target == BuildTarget.Android && settingsExist && !exclusionActive)
        {
            throw new BuildFailedException(
                "Android builds cannot include local Meta DevAgent settings. Use a build path that excludes the local settings asset."
            );
        }
    }

    // Run before Meta's processor injects local connection credentials into this resource.
    public int callbackOrder => int.MinValue;

    public void OnPreprocessBuild(BuildReport report)
    {
        ValidateBuildPolicy(report.summary.platform, File.Exists(SettingsPath), ActiveExclusion != null);
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
