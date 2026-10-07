using System;
using System.Collections.Generic;
using Unframe.Unity.PresentationRuntime;
using Unity.XR.Management.AndroidManifest.Editor;
using UnityEditor.Build.Reporting;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine.XR.OpenXR;

namespace Unframe.Unity.Editor
{
    internal sealed class QuestBodyTrackingManifest : OpenXRFeatureBuildHooks
    {
        public QuestBodyTrackingManifest() { }

        public override int callbackOrder => 2;
        public override Type featureType => typeof(QuestBodyTrackingFeature);

        protected override void OnPreprocessBuildExt(BuildReport report) { }
        protected override void OnPostGenerateGradleAndroidProjectExt(string path) { }
        protected override void OnPostprocessBuildExt(BuildReport report) { }

        protected override ManifestRequirement ProvideManifestRequirementExt() => BuildRequirement();

        internal static ManifestRequirement BuildRequirement()
        {
            return new ManifestRequirement
            {
                SupportedXRLoaders = new HashSet<Type> { typeof(OpenXRLoader) },
                NewElements = new List<ManifestElement>
                {
                    Element("uses-permission", "com.oculus.permission.BODY_TRACKING"),
                    Element("uses-feature", "com.oculus.software.body_tracking", "false"),
                    Element("uses-feature", "com.oculus.experimental.enabled", "false"),
                }
            };
        }

        private static ManifestElement Element(string kind, string name, string required = null)
        {
            var attributes = new Dictionary<string, string> { { "name", name } };
            if (required != null) attributes.Add("required", required);
            return new ManifestElement
            {
                ElementPath = new List<string> { "manifest", kind },
                Attributes = attributes
            };
        }
    }
}
