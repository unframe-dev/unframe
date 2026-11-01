export const mediaTypeFor = (path: string): string => {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return (
    (
      {
        ".ts": "text/typescript",
        ".tsx": "text/tsx",
        ".mts": "text/typescript",
        ".cts": "text/typescript",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".cjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
};
