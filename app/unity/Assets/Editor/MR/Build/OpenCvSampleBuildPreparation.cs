using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Build;

public static class OpenCvSampleBuildPreparation
{
    internal static readonly string[] SamplePaths =
    {
        "Assets/OpenCVForUnity/Examples",
        "Assets/StreamingAssets/OpenCVForUnityExamples"
    };
    internal const string LocalSamplesPath = "LocalOnly/OpenCVForUnitySamples";

    internal static void MoveSamples(string projectRoot, bool exclude)
    {
        var moves = new List<(string source, string destination)>();
        for (int i = 0; i < SamplePaths.Length; i++)
        {
            string asset = Path.Combine(projectRoot, SamplePaths[i]);
            string saved = Path.Combine(projectRoot, LocalSamplesPath, i == 0 ? "Examples" : "StreamingAssets");
            string source = exclude ? asset : saved;
            string destination = exclude ? saved : asset;
            foreach (string suffix in new[] { "", ".meta" })
            {
                string from = source + suffix;
                string to = destination + suffix;
                if (!Exists(from)) continue;
                if (Exists(to))
                    throw new IOException($"Both sample copies exist: {from} and {to}. Keep both and resolve the conflict before preparing the build.");
                moves.Add((from, to));
            }
        }

        var completed = new List<(string source, string destination)>();
        try
        {
            foreach (var move in moves)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(move.destination));
                Move(move.source, move.destination);
                completed.Add(move);
            }
        }
        catch (Exception original)
        {
            var failures = new List<Exception> { original };
            for (int i = completed.Count - 1; i >= 0; i--)
            {
                try { Move(completed[i].destination, completed[i].source); }
                catch (Exception rollback) { failures.Add(rollback); }
            }
            if (failures.Count > 1) throw new AggregateException("Sample preparation and restoration failed. Preserve both sample locations for recovery.", failures);
            throw;
        }
    }

    private static bool Exists(string path) => File.Exists(path) || Directory.Exists(path);

    private static void Move(string source, string destination)
    {
        if (Directory.Exists(source)) Directory.Move(source, destination);
        else File.Move(source, destination);
    }

    internal static void ValidateSamplesExcluded(string projectRoot)
    {
        foreach (string path in SamplePaths)
            if (Exists(Path.Combine(projectRoot, path)))
                throw new BuildFailedException("OpenCV samples are still imported. Run Unframe > Tools > OpenCV > Prepare Fast Builds (Exclude OpenCV Samples), wait for compilation, then build again.");
    }

    [MenuItem("Unframe/Tools/OpenCV/Prepare Fast Builds (Exclude OpenCV Samples)")]
    public static void PrepareSamples() => Prepare(true);

    [MenuItem("Unframe/Tools/OpenCV/Restore OpenCV Samples")]
    public static void RestoreSamples() => Prepare(false);

    private static void Prepare(bool exclude)
    {
        if (BuildPipeline.isBuildingPlayer || EditorApplication.isCompiling)
            throw new InvalidOperationException("Wait for the current build or script compilation before moving OpenCV samples.");
        MoveSamples(Path.GetDirectoryName(UnityEngine.Application.dataPath), exclude);
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        UnityEngine.Debug.Log(exclude ? "[PCA] OpenCV samples excluded. Wait for compilation before building."
            : "[PCA] OpenCV samples restored. Prepare Fast Builds again before a diagnostic build.");
    }
}
