import { ident, parse, string, tokenize, tokenTypes, url, walk } from "css-tree";

const normalizeUrlFunctions = (source: string): string => {
  let normalized = "";
  let previous = 0;
  tokenize(source, (type, start, end) => {
    if (type !== tokenTypes.Function) return;
    const name = source.slice(start, end - 1);
    if (ident.decode(name).toLowerCase() !== "url") return;
    normalized += `${source.slice(previous, start)}url(`;
    previous = end;
  });
  return normalized + source.slice(previous);
};

const dependencyUrls = (source: string, importPrelude: boolean): string[] => {
  const urls: string[] = [];
  let first = true;
  let quotedUrl = false;
  tokenize(source, (type, start, end) => {
    if (type === tokenTypes.WhiteSpace || type === tokenTypes.Comment) return;
    if (importPrelude && !first && !quotedUrl) return;
    const token = source.slice(start, end);
    if (type === tokenTypes.Url) urls.push(url.decode(token));
    if (type === tokenTypes.String && (quotedUrl || (importPrelude && first)))
      urls.push(string.decode(token));
    quotedUrl =
      type === tokenTypes.Function && ident.decode(token.slice(0, -1)).toLowerCase() === "url";
    first = false;
  });
  return urls;
};

export const cssDependencies = (source: string) => {
  const dependencies: { specifier: string; kind: "import" }[] = [];
  const ast = parse(normalizeUrlFunctions(source), {
    parseAtrulePrelude: false,
    parseRulePrelude: false,
    parseValue: false,
    parseCustomProperty: false,
    onParseError: (error) => {
      throw error;
    },
  });
  walk(ast, (node) => {
    if (node.type === "Declaration" && node.value.type === "Raw") {
      for (const specifier of dependencyUrls(node.value.value, false))
        dependencies.push({ specifier, kind: "import" });
    }
    if (
      node.type === "Atrule" &&
      ident.decode(node.name).toLowerCase() === "import" &&
      node.prelude?.type === "Raw"
    ) {
      for (const specifier of dependencyUrls(node.prelude.value, true))
        dependencies.push({ specifier, kind: "import" });
    }
  });
  return dependencies;
};
