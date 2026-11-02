using System;
using GestureKind = Unframe.Presentation.GestureKind;
using UnityEngine;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    internal sealed class QuestMotionArmRig : IDisposable
    {
        private readonly GameObject instance;
        private readonly Animator animator;
        private readonly Vector3 authoredScale;
        private GestureKind playing;

        public QuestMotionArmRig(GameObject prefab, Transform parent, bool left)
        {
            if (prefab == null) throw new InvalidOperationException("editable-motion-arm-missing");
            instance = UnityEngine.Object.Instantiate(prefab, parent, false);
            instance.name = left ? "Left motion arm" : "Right motion arm";
            animator = instance.GetComponent<Animator>();
            if (animator == null || animator.runtimeAnimatorController == null)
            {
                Destroy(instance);
                throw new InvalidOperationException("editable-motion-controller-missing");
            }
            authoredScale = instance.transform.localScale;
            instance.transform.localScale = authoredScale * QuestMotionGuideGeometry.DisplayScale;
            Transform model = instance.transform.Find("ArmModel");
            if (model == null)
            {
                Destroy(instance);
                throw new InvalidOperationException("editable-motion-model-missing");
            }
            // Correct the model facing without reversing the clip's gesture translation.
            model.localRotation = Quaternion.Euler(0, 180, 0) * model.localRotation;
            animator.applyRootMotion = false;
            animator.updateMode = AnimatorUpdateMode.UnscaledTime;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            instance.SetActive(false);
        }

        public void SetVisible(bool visible)
        {
            if (instance.activeSelf == visible) return;
            instance.SetActive(visible);
            if (!visible) playing = 0;
        }

        public void Play(Vector3 center, Quaternion frame, GestureKind gesture, float viewportScale)
        {
            instance.transform.localScale = authoredScale * (QuestMotionGuideGeometry.DisplayScale * viewportScale);
            instance.transform.SetPositionAndRotation(center, frame);
            if (playing == gesture) return;
            int state = Animator.StringToHash("Base Layer." + gesture);
            if (!animator.HasState(0, state)) throw new InvalidOperationException("motion-animation-missing");
            animator.Play(state, 0, 0);
            playing = gesture;
        }

        public void Dispose() => Destroy(instance);
        private static void Destroy(UnityEngine.Object value)
        {
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
