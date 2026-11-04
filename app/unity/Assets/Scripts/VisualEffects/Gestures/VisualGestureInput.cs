using System;
using UnityEngine;

namespace Unframe.Unity.VisualEffects.Gestures
{
    public sealed class VisualGestureInput : MonoBehaviour
    {
        [SerializeField] private GestureRecognitionSettings settings = new GestureRecognitionSettings();
        private VisualGestureRecognizer recognizer;
        public event Action<GestureRecognition> Recognized;
        public bool Begin(VisualGesture kind, GestureHand hand, GestureSample sample)
        {
            recognizer ??= new VisualGestureRecognizer(settings);
            return recognizer.Begin(kind, hand, sample);
        }
        public void PushSample(GestureSample sample)
        {
            var result = recognizer?.Update(sample);
            if (result != null) Recognized?.Invoke(result);
        }
        public void Cancel() => recognizer?.Cancel();
        private void OnDisable() => Cancel();
    }
}
