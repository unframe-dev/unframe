using System;
using System.Collections;

public interface IPresentationJsonSource
{
    IEnumerator Load(Action<string> onLoaded, Action<string> onFailed);
}
