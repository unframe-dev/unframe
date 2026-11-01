export const localCssDependency = (specifier: string): string | undefined => {
  if (specifier.startsWith("#")) return undefined;
  if (!specifier || specifier.startsWith("/") || /[\\?#:\0]/u.test(specifier))
    throw new Error("CSS dependencies must use locked relative URLs.");
  return specifier;
};
