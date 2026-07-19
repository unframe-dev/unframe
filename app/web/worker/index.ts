const EDITOR_PREFIX = "/editor";

export function rewriteEditorAssetRequest(request: Request): Request {
  const url = new URL(request.url);

  if (url.pathname === EDITOR_PREFIX || url.pathname === `${EDITOR_PREFIX}/`) {
    url.pathname = "/";
  } else if (url.pathname.startsWith(`${EDITOR_PREFIX}/`)) {
    url.pathname = url.pathname.slice(EDITOR_PREFIX.length);
  }

  return new Request(url, request);
}

export default {
  fetch(request, env) {
    return env.ASSETS.fetch(rewriteEditorAssetRequest(request));
  },
} satisfies ExportedHandler<CloudflareBindings>;
