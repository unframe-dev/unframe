import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const targetName = "NotoSansCJKjp-Regular";
const align = (size) => Math.ceil(size / 4) * 4;
function range(buffer, offset, length) {
  if (offset < 0 || length < 0 || offset > buffer.length - length) {
    throw new Error("Font data is out of bounds");
  }
  return buffer.subarray(offset, offset + length);
}
function checksum(data) {
  let result = 0;
  for (let i = 0; i < data.length; i++) {
    result = (result + data[i] * 2 ** (24 - 8 * (i % 4))) >>> 0;
  }
  return result;
}
function postScriptNames(data) {
  range(data, 0, 6);
  const format = data.readUInt16BE(0);
  if (format !== 0 && format !== 1) throw new Error("Unsupported name table version");
  const count = data.readUInt16BE(2);
  const storage = data.readUInt16BE(4);
  range(data, 6, count * 12);
  if (storage < 6 + count * 12) throw new Error("Invalid name string storage");
  const names = new Set();
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const bytes = range(
      data,
      storage + data.readUInt16BE(record + 10),
      data.readUInt16BE(record + 8),
    );
    if (data.readUInt16BE(record + 6) !== 6) continue;
    const platform = data.readUInt16BE(record);
    if (platform === 0 || platform === 3) {
      if (bytes.length % 2) throw new Error("Invalid UTF-16 PostScript name");
      names.add(Buffer.from(bytes).swap16().toString("utf16le"));
    } else if (platform === 1 && data.readUInt16BE(record + 2) === 0) {
      if (bytes.some((byte) => byte > 127)) throw new Error("Invalid ASCII PostScript name");
      names.add(bytes.toString("ascii"));
    }
  }
  return names;
}

// Only the pinned Noto CFF collection is supported; outlines and layout tables
// remain opaque. Collection offsets become standalone sfnt offsets per
// https://learn.microsoft.com/en-us/typography/opentype/spec/otff.
export function extractPresentationFont(collection) {
  range(collection, 0, 12);
  if (collection.toString("latin1", 0, 4) !== "ttcf") throw new Error("Expected a TTC collection");
  const version = collection.readUInt32BE(4);
  if (version !== 0x10000 && version !== 0x20000) throw new Error("Unsupported TTC version");
  const count = collection.readUInt32BE(8);
  range(collection, 12, count * 4 + (version === 0x20000 ? 12 : 0));
  const matches = [];
  for (let i = 0; i < count; i++) {
    const offset = collection.readUInt32BE(12 + i * 4);
    range(collection, offset, 12);
    if (collection.toString("latin1", offset, offset + 4) !== "OTTO")
      throw new Error("Expected CFF OpenType face");
    const tableCount = collection.readUInt16BE(offset + 4);
    if (!tableCount || tableCount > 4095) throw new Error("Invalid table count");
    range(collection, offset + 12, tableCount * 16);
    const tables = new Map();
    for (let j = 0; j < tableCount; j++) {
      const record = offset + 12 + j * 16;
      const tag = collection.toString("latin1", record, record + 4);
      if (tables.has(tag)) throw new Error("Unexpected duplicate table");
      const position = collection.readUInt32BE(record + 8);
      if (position % 4) throw new Error("Unaligned table offset");
      const data = Buffer.from(range(collection, position, collection.readUInt32BE(record + 12)));
      if (tag === "head") {
        range(data, 0, 54);
        // head's checksum is computed with checkSumAdjustment set to zero.
        data.writeUInt32BE(0, 8);
      }
      if (checksum(data) !== collection.readUInt32BE(record + 4))
        throw new Error("Invalid table checksum");
      tables.set(tag, data);
    }
    if (!tables.has("name") || !tables.has("head") || !tables.has("CFF "))
      throw new Error("Missing required font table");
    const names = postScriptNames(tables.get("name"));
    if (names.has(targetName)) {
      if (names.size !== 1) throw new Error("Conflicting PostScript names");
      matches.push(tables);
    }
  }
  if (matches.length !== 1) throw new Error("Expected exactly one Noto Sans CJK JP Regular face");
  const tables = [...matches[0]].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // A digital signature of the collection cannot authenticate a rebuilt font.
  if (matches[0].has("DSIG")) throw new Error("Signed collections are unsupported");
  const directorySize = 12 + tables.length * 16;
  const output = Buffer.alloc(
    directorySize + tables.reduce((total, [, data]) => total + align(data.length), 0),
  );
  output.write("OTTO");
  output.writeUInt16BE(tables.length, 4);
  const selector = Math.floor(Math.log2(tables.length));
  const searchRange = 2 ** selector * 16;
  output.writeUInt16BE(searchRange, 6);
  output.writeUInt16BE(selector, 8);
  output.writeUInt16BE(tables.length * 16 - searchRange, 10);
  let offset = directorySize;
  let headOffset;
  for (const [i, [tag, data]] of tables.entries()) {
    const record = 12 + i * 16;
    output.write(tag, record, 4, "latin1");
    output.writeUInt32BE(checksum(data), record + 4);
    output.writeUInt32BE(offset, record + 8);
    output.writeUInt32BE(data.length, record + 12);
    data.copy(output, offset);
    if (tag === "head") headOffset = offset;
    offset += align(data.length);
  }
  output.writeUInt32BE((0xb1b0afba - checksum(output)) >>> 0, headOffset + 8);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4)
    throw new Error("Usage: extract-presentation-font.mjs input.ttc output.otf");
  await writeFile(process.argv[3], extractPresentationFont(await readFile(process.argv[2])));
}
