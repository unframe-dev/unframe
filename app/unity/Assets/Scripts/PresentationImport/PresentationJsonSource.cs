using System;
using System.Collections;
using UnityEngine;

public abstract class PresentationJsonSource : MonoBehaviour, IPresentationJsonSource
{
    public abstract IEnumerator Load(Action<string> onLoaded, Action<string> onFailed);
}
