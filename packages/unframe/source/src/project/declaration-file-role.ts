export const declarationFileRole = (fileName: string, entryFileName: string) => {
  if (fileName === entryFileName)
    return { role: "presentation", rootBuilder: "definePresentation" } as const;
  if (fileName.endsWith(".unframe.ts"))
    return { role: "theme", rootBuilder: "defineTheme" } as const;
  if (fileName.endsWith(".manifest.ts"))
    return { role: "component-manifest", rootBuilder: "defineComponentManifest" } as const;
  if (fileName.endsWith(".structure.tsx"))
    return { role: "component-structure", rootBuilder: "defineComponentStructure" } as const;
  return undefined;
};
