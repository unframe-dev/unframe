import { createHash } from "node:crypto";
import type { CDPSession } from "playwright-core";
import { decodeFontAsset, type FontCoverage } from "../../rendering/font-assets.js";
import type { OpaqueCaptureRequest } from "./types.js";

type Face = { family: string; sources: ReadonlyArray<string>; style: string; weight: string };

const inspectFaces = `(() => {
  const faces = [];
  const visit = rules => {
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) visit(rule.styleSheet.cssRules);
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const src = rule.style.getPropertyValue('src');
      const sources = [...src.matchAll(/url\\(\\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\\s*\\)/gi)]
        .map(match => new URL(match[1] ?? match[2] ?? match[3], rule.parentStyleSheet.href ?? document.baseURI).href);
      faces.push({family:rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g,''),
        weight:rule.style.getPropertyValue('font-weight').trim() || 'normal',
        style:rule.style.getPropertyValue('font-style').trim() || 'normal',
        sources, validSource: sources.length > 0 && !/local\\s*\\(/i.test(src) &&
          (src.match(/url\\s*\\(/gi) ?? []).length === sources.length});
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules);
  return {faces, registered:[...document.fonts].map(face=>({family:face.family.replace(/^["']|["']$/g,''),
    weight:face.weight,style:face.style,status:face.status}))};
})()`;

const fontNames = (bytes: Uint8Array): ReadonlyArray<string> => {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (offset: number) => {
      if (offset < 0 || offset + 2 > bytes.length) {
        throw new RangeError();
      }
      return view.getUint16(offset);
    };
    const u32 = (offset: number) => {
      if (offset < 0 || offset + 4 > bytes.length) {
        throw new RangeError();
      }
      return view.getUint32(offset);
    };
    const tableCount = u16(4);
    if (tableCount > 4096) {
      throw new RangeError();
    }
    for (let index = 0; index < tableCount; index++) {
      const record = 12 + index * 16;
      if (Buffer.from(bytes.subarray(record, record + 4)).toString("ascii") !== "name") {
        continue;
      }
      const offset = u32(record + 8);
      const length = u32(record + 12);
      if (offset + length > bytes.length) {
        throw new RangeError();
      }
      const count = u16(offset + 2);
      const storage = offset + u16(offset + 4);
      const names = new Set<string>();
      for (let item = 0; item < count; item++) {
        const entry = offset + 6 + item * 12;
        const platform = u16(entry);
        const nameId = u16(entry + 6);
        if (nameId !== 6 || (platform !== 0 && platform !== 3)) {
          continue;
        }
        const size = u16(entry + 8);
        const start = storage + u16(entry + 10);
        if (start + size > offset + length || size % 2 !== 0) {
          throw new RangeError();
        }
        let name = "";
        for (let char = 0; char < size; char += 2) {
          name += String.fromCharCode(u16(start + char));
        }
        if (name) {
          names.add(name);
        }
      }
      return [...names];
    }
  } catch {
    return [];
  }
  return [];
};

const fontWeightAndStyle = (bytes: Uint8Array) => {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (offset: number) => {
      if (offset < 0 || offset + 2 > bytes.length) {
        throw new RangeError();
      }
      return view.getUint16(offset);
    };
    const u32 = (offset: number) => {
      if (offset < 0 || offset + 4 > bytes.length) {
        throw new RangeError();
      }
      return view.getUint32(offset);
    };
    const tables = new Map<string, { length: number; offset: number }>();
    for (let index = 0; index < u16(4); index++) {
      const entry = 12 + index * 16;
      const offset = u32(entry + 8);
      const length = u32(entry + 12);
      if (offset + length > bytes.length) {
        throw new RangeError();
      }
      tables.set(Buffer.from(bytes.subarray(entry, entry + 4)).toString("ascii"), {
        length,
        offset,
      });
    }
    const os2 = tables.get("OS/2");
    if (!os2 || os2.length < 64) {
      throw new RangeError();
    }
    const weight = u16(os2.offset + 4);
    const italic = (u16(os2.offset + 62) & 1) !== 0;
    let minimum = weight;
    let maximum = weight;
    const fvar = tables.get("fvar");
    if (fvar) {
      const count = u16(fvar.offset + 8);
      const size = u16(fvar.offset + 10);
      const axes = u16(fvar.offset + 4);
      if (axes + count * size > fvar.length || size < 20) {
        throw new RangeError();
      }
      for (let index = 0; index < count; index++) {
        const entry = fvar.offset + axes + index * size;
        if (Buffer.from(bytes.subarray(entry, entry + 4)).toString("ascii") !== "wght") {
          continue;
        }
        minimum = view.getInt32(entry + 4) / 65_536;
        maximum = view.getInt32(entry + 12) / 65_536;
      }
    }
    if (minimum < 1 || maximum > 1000 || minimum > maximum) {
      throw new RangeError();
    }
    return { maximum, minimum, style: italic ? "italic" : "normal" };
  } catch {
    return undefined;
  }
};

const declaredWeights = (descriptor: string) => {
  const weights = descriptor
    .split(/\s+/)
    .map((value) => Number(value === "normal" ? 400 : value === "bold" ? 700 : value));
  if (
    weights.length === 0 ||
    weights.length > 2 ||
    weights.some((weight) => !Number.isFinite(weight))
  ) {
    return undefined;
  }
  return { maximum: weights[1] ?? weights[0]!, minimum: weights[0]! };
};

const weightMatches = (descriptor: string, requested: string) => {
  const requestedNumber = Number(
    requested === "normal" ? 400 : requested === "bold" ? 700 : requested,
  );
  const weights = declaredWeights(descriptor);
  return (
    Number.isFinite(requestedNumber) &&
    weights !== undefined &&
    requestedNumber >= weights.minimum &&
    requestedNumber <= weights.maximum
  );
};

export const createOpaqueFontValidator = async (
  assets: OpaqueCaptureRequest["assets"],
  cdp: CDPSession,
  isolated: <T>(expression: string) => Promise<T>,
): Promise<() => Promise<void>> => {
  const locked = new Map<string, { path: string; supports: FontCoverage }>();
  const metadata = new Map<string, NonNullable<ReturnType<typeof fontWeightAndStyle>>>();
  const paths = new Set<string>();
  for (const asset of assets) {
    if (asset.mediaType !== "font/ttf" && asset.mediaType !== "font/otf") {
      continue;
    }
    const bytes = Buffer.from(asset.dataBase64, "base64");
    const decoded = decodeFontAsset(asset.path, {
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      dataBase64: asset.dataBase64,
      mediaType: asset.mediaType,
    });
    if ("ok" in decoded) {
      throw new Error("opaque-font-invalid");
    }
    const names = fontNames(bytes);
    const fontMetadata = fontWeightAndStyle(bytes);
    if (names.length === 0 || !fontMetadata) {
      throw new Error("opaque-font-invalid");
    }
    const path = new URL(asset.path, "https://unframe.invalid/").href;
    for (const name of names) {
      if (locked.has(name)) {
        throw new Error("opaque-font-invalid");
      }
      locked.set(name, { path, supports: decoded.supports });
    }
    paths.add(path);
    metadata.set(path, fontMetadata);
  }
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");

  return async () => {
    const inspected = await isolated<{
      faces: Array<Face & { validSource: boolean }>;
      registered: Array<{ family: string; status: string; style: string; weight: string }>;
    }>(inspectFaces);
    if (
      inspected.faces.some(
        (face) => !face.validSource || face.sources.some((url) => !paths.has(url)),
      )
    ) {
      throw new Error("opaque-font-unlocked");
    }
    if (
      inspected.faces.some((face) => {
        const weights = declaredWeights(face.weight);
        return (
          !weights ||
          face.sources.some((source) => {
            const actual = metadata.get(source);
            return (
              !actual ||
              weights.minimum < actual.minimum ||
              weights.maximum > actual.maximum ||
              face.style !== actual.style
            );
          })
        );
      })
    ) {
      throw new Error("opaque-font-invalid");
    }
    const faceKey = (face: Pick<Face, "family" | "weight" | "style">) =>
      JSON.stringify([face.family, face.weight, face.style]);
    const declared = new Map<string, number>();
    for (const face of inspected.faces) {
      declared.set(faceKey(face), (declared.get(faceKey(face)) ?? 0) + 1);
    }
    for (const face of inspected.registered) {
      declared.set(faceKey(face), (declared.get(faceKey(face)) ?? 0) - 1);
    }
    if (
      inspected.registered.some((face) => face.status !== "loaded") ||
      [...declared.values()].some((count) => count !== 0)
    ) {
      throw new Error("opaque-font-invalid");
    }

    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const visit = async (node: typeof root, parentId?: number): Promise<void> => {
      if (node.pseudoType) {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
        if (fonts.some((font) => font.glyphCount > 0)) {
          throw new Error("opaque-font-invalid");
        }
      }
      if (node.nodeType === 3 && node.nodeValue && parentId !== undefined) {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
        if (fonts.some((font) => font.glyphCount > 0)) {
          const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", {
            nodeId: parentId,
          });
          const properties = new Map(
            computedStyle.map((property) => [property.name, property.value]),
          );
          const family = properties.get("font-family") ?? "";
          const weight = properties.get("font-weight") ?? "400";
          const style = properties.get("font-style") ?? "normal";
          const families = family
            .split(",")
            .map((value) => value.trim().replaceAll(/^["']|["']$/g, ""));
          const candidatePaths = inspected.faces
            .filter(
              (face) =>
                families.includes(face.family) &&
                weightMatches(face.weight, weight) &&
                face.style === style,
            )
            .flatMap((face) => face.sources);
          const candidates = [...locked.values()].filter((font) =>
            candidatePaths.includes(font.path),
          );
          if (candidates.length === 0) {
            throw new Error("opaque-font-unlocked");
          }
          for (const character of node.nodeValue) {
            if (!candidates.some((font) => font.supports(character.codePointAt(0)!))) {
              throw new Error("opaque-font-glyph-missing");
            }
          }
          const coverages = fonts
            .filter((font) => font.glyphCount > 0)
            .map((font) => {
              if (!font.isCustomFont) {
                throw new Error("opaque-font-unlocked");
              }
              const lockedFont = locked.get(font.postScriptName);
              if (
                !lockedFont ||
                !inspected.faces.some(
                  (face) =>
                    families.includes(face.family) &&
                    face.sources.includes(lockedFont.path) &&
                    weightMatches(face.weight, weight) &&
                    face.style === style,
                )
              ) {
                throw new Error("opaque-font-unlocked");
              }
              return lockedFont.supports;
            });
          for (const character of node.nodeValue) {
            if (!coverages.some((supports) => supports(character.codePointAt(0)!))) {
              throw new Error("opaque-font-glyph-missing");
            }
          }
        }
      }
      for (const child of node.children ?? []) {
        await visit(child, node.nodeId);
      }
      for (const pseudo of node.pseudoElements ?? []) {
        await visit(pseudo, node.nodeId);
      }
      for (const shadow of node.shadowRoots ?? []) {
        await visit(shadow, node.nodeId);
      }
    };
    await visit(root);
  };
};
