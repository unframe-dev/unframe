using System;
using System.IO;
using NUnit.Framework;

public sealed class PassthroughCameraBuildAssetExclusionTests
{
    [TestCase(false)]
    [TestCase(true)]
    public void LocalResourceAndMetaAreExcludedAndRestoredEvenAfterBuildFailure(bool failBuild)
    {
        string directory = Path.Combine(Path.GetTempPath(), "pca-exclusion-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string asset = Path.Combine(directory, "DevAgentSettings.asset");
        string backup = Path.Combine(directory, "backup");
        File.WriteAllText(asset, "local configuration");
        File.WriteAllText(asset + ".meta", "original guid");
        try
        {
            using (var exclusion = new PassthroughCameraBuildAssetExclusion.AssetFileExclusion(asset, backup))
            {
                exclusion.Exclude();
                Assert.That(File.Exists(asset), Is.False);
                Assert.That(File.Exists(asset + ".meta"), Is.False);
                if (failBuild) throw new InvalidOperationException("Simulated build failure");
            }
        }
        catch (InvalidOperationException) when (failBuild) { }
        finally
        {
            try
            {
                Assert.That(File.ReadAllText(asset), Is.EqualTo("local configuration"));
                Assert.That(File.ReadAllText(asset + ".meta"), Is.EqualTo("original guid"));
                Assert.That(Directory.Exists(backup), Is.False);
            }
            finally
            {
                Directory.Delete(directory, true);
            }
        }
    }
}
