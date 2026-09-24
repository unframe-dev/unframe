export type WebGLContextFactory = () => WebGLRenderingContext | null;

function createWebGLContext(): WebGLRenderingContext | null {
  const canvas = document.createElement("canvas");
  return (
    (canvas.getContext("webgl2") as WebGLRenderingContext | null) ?? canvas.getContext("webgl")
  );
}

export function detectWebGLSupport(
  createContext: WebGLContextFactory = createWebGLContext,
): boolean {
  try {
    return createContext() !== null;
  } catch {
    return false;
  }
}
