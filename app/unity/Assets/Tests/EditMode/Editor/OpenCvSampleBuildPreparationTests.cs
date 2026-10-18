using System;
using System.IO;
using NUnit.Framework;
using UnityEditor.Build;

public sealed class OpenCvSampleBuildPreparationTests
{
    private string project;

    [SetUp]
    public void SetUp()
    {
        project = Path.Combine(Path.GetTempPath(), "unframe-samples-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(project);
    }

    [TearDown]
    public void TearDown() => Directory.Delete(project, true);

    [Test]
    public void ExclusionPreservesSampleFilesAndGuidsAndCanBeRestored()
    {
        CreateSamples();
        OpenCvSampleBuildPreparation.MoveSamples(project, true);
        Assert.DoesNotThrow(() => OpenCvSampleBuildPreparation.ValidateSamplesExcluded(project));
        foreach (string path in OpenCvSampleBuildPreparation.SamplePaths)
            Assert.That(Directory.Exists(Path.Combine(project, path)), Is.False);
        OpenCvSampleBuildPreparation.MoveSamples(project, true);
        OpenCvSampleBuildPreparation.MoveSamples(project, false);
        foreach (string path in OpenCvSampleBuildPreparation.SamplePaths)
        {
            Assert.That(File.ReadAllText(Path.Combine(project, path, "sample.txt")), Is.EqualTo(path));
            Assert.That(File.ReadAllText(Path.Combine(project, path + ".meta")), Is.EqualTo("guid: original"));
        }
    }

    [Test]
    public void BuildsFailWithActionableMessageUntilSamplesAreExcluded()
    {
        CreateSamples();
        var error = Assert.Throws<BuildFailedException>(() => OpenCvSampleBuildPreparation.ValidateSamplesExcluded(project));
        StringAssert.Contains("Prepare Fast Builds", error.Message);
    }

    [Test]
    public void ConflictingLocalBackupDoesNotOverwriteEitherCopyOrMoveOtherSamples()
    {
        CreateSamples();
        string backup = Path.Combine(project, OpenCvSampleBuildPreparation.LocalSamplesPath, "StreamingAssets");
        Directory.CreateDirectory(backup);
        File.WriteAllText(Path.Combine(backup, "keep.txt"), "backup");
        Assert.Throws<IOException>(() => OpenCvSampleBuildPreparation.MoveSamples(project, true));
        foreach (string path in OpenCvSampleBuildPreparation.SamplePaths)
            Assert.That(File.Exists(Path.Combine(project, path, "sample.txt")), Is.True);
        Assert.That(File.ReadAllText(Path.Combine(backup, "keep.txt")), Is.EqualTo("backup"));
    }

    [Test]
    public void PartialReimportRequiresPreparationAgainWithoutOverwritingTheSavedSamples()
    {
        CreateSamples();
        OpenCvSampleBuildPreparation.MoveSamples(project, true);
        string path = Path.Combine(project, OpenCvSampleBuildPreparation.SamplePaths[0]);
        Directory.CreateDirectory(path);
        File.WriteAllText(Path.Combine(path, "new.txt"), "new import");
        Assert.Throws<BuildFailedException>(() => OpenCvSampleBuildPreparation.ValidateSamplesExcluded(project));
        Assert.Throws<IOException>(() => OpenCvSampleBuildPreparation.MoveSamples(project, true));
        Assert.That(File.ReadAllText(Path.Combine(path, "new.txt")), Is.EqualTo("new import"));
    }

    [Test]
    public void MissingSamplesAreAllowedWithoutInstallingAnyAdditionalAsset()
    {
        Assert.DoesNotThrow(() => OpenCvSampleBuildPreparation.MoveSamples(project, true));
        Assert.DoesNotThrow(() => OpenCvSampleBuildPreparation.ValidateSamplesExcluded(project));
    }

    private void CreateSamples()
    {
        foreach (string path in OpenCvSampleBuildPreparation.SamplePaths)
        {
            string directory = Path.Combine(project, path);
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "sample.txt"), path);
            File.WriteAllText(directory + ".meta", "guid: original");
        }
    }
}
