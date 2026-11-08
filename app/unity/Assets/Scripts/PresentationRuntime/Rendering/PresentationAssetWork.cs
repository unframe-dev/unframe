using System;
using System.Threading;
using System.Threading.Tasks;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationAssetWork
    {
        internal static Task<T> Run<T>(Func<T> work, CancellationToken token)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // The single-threaded WebGL player cannot schedule thread-pool work.
            try { token.ThrowIfCancellationRequested(); return Task.FromResult(work()); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { return Task.FromCanceled<T>(token); }
            catch (Exception exception) { return Task.FromException<T>(exception); }
#else
            return Task.Run(work, token);
#endif
        }

        internal static Task Run(Action work, CancellationToken token) => Run(() => { work(); return true; }, token);
    }
}
