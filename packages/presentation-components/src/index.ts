export { standardSurfaceManifest } from "./standard-surface.manifest.js";
export { standardSurfaceStructure } from "./standard-surface.structure.js";
export { standardTheme, standardThemeStyleIds } from "./standard-theme.js";

import { standardSurfaceManifest } from "./standard-surface.manifest.js";
import { standardSurfaceStructure } from "./standard-surface.structure.js";
import { standardTheme } from "./standard-theme.js";

export const standardComponents = {
  surface: {
    manifest: standardSurfaceManifest,
    structure: standardSurfaceStructure,
  },
  theme: standardTheme,
} as const;
