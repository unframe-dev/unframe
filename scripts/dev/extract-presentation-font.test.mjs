import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPresentationFont } from "./extract-presentation-font.mjs";

const name = "NotoSansCJKjp-Regular";
function fixture(names = [name]) {
  const font = Buffer.alloc(4096);
  font.write("ttcf");
  font.writeUInt32BE(0x10000, 4);
  font.writeUInt32BE(names.length, 8);
  let end = 128;
  for (let i = 0; i < names.length; i++) {
    const start = end;
    font.writeUInt32BE(start, 12 + i * 4);
    font.write("OTTO", start);
    font.writeUInt16BE(3, start + 4);
    end += 60;
    const encoded = Buffer.from(names[i], "utf16le").swap16();
    const naming = Buffer.alloc(18 + encoded.length);
    naming.writeUInt16BE(1, 2);
    naming.writeUInt16BE(18, 4);
    [3, 1, 0x409, 6, encoded.length, 0].forEach((n, j) => naming.writeUInt16BE(n, 6 + 2 * j));
    encoded.copy(naming, 18);
    for (const [j, [tag, data]] of [
      ["CFF ", Buffer.from([1, 0, 4, 4])],
      ["head", Buffer.alloc(54)],
      ["name", naming],
    ].entries()) {
      const record = start + 12 + 16 * j;
      font.write(tag, record);
      font.writeUInt32BE(end, record + 8);
      font.writeUInt32BE(data.length, record + 12);
      if (tag === "head") data.writeBigUInt64BE(0x0102030405060708n, 28);
      data.copy(font, end);
      let sum = 0;
      for (let p = 0; p < data.length; p++) sum = (sum + data[p] * 2 ** (24 - 8 * (p % 4))) >>> 0;
      font.writeUInt32BE(sum, record + 4);
      end += Math.ceil(data.length / 4) * 4;
    }
  }
  return font.subarray(0, end);
}

test("extracts one face, recalculates standalone checksums and preserves timestamps", () => {
  const source = fixture(["Other", name]);
  const out = extractPresentationFont(source);
  assert.equal(out.toString("ascii", 0, 4), "OTTO");
  let sum = 0;
  for (let p = 0; p < out.length; p += 4) sum = (sum + out.readUInt32BE(p)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  const headRecord = 28;
  const offset = out.readUInt32BE(headRecord + 8);
  assert.equal(out.readBigUInt64BE(offset + 28), 0x0102030405060708n);
});
test("rejects missing or duplicate matching faces", () => {
  assert.throws(() => extractPresentationFont(fixture(["Other"])), /exactly one/);
  assert.throws(() => extractPresentationFont(fixture([name, name])), /exactly one/);
});
test("rejects corrupt tables, duplicate tags, unsupported versions and truncated offsets", () => {
  const corrupt = fixture();
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => extractPresentationFont(corrupt), /checksum/);
  const duplicate = fixture();
  duplicate.write("CFF ", 128 + 12 + 16);
  assert.throws(() => extractPresentationFont(duplicate), /duplicate/);
  const version = fixture();
  version.writeUInt32BE(0x30000, 4);
  assert.throws(() => extractPresentationFont(version), /version/);
  const bounds = fixture();
  bounds.writeUInt32BE(0xfffffffc, 128 + 12 + 8);
  assert.throws(() => extractPresentationFont(bounds), /bounds/);
  assert.throws(() => extractPresentationFont(fixture().subarray(0, 20)), /bounds/);
});
test("rejects out-of-bounds name strings and table records", () => {
  const data = fixture();
  const naming = data.readUInt32BE(128 + 12 + 32 + 8);
  data.writeUInt16BE(0xffff, naming + 16);
  // Disable table checksum failure to reach the name record bounds check.
  let sum = 0;
  const length = data.readUInt32BE(128 + 12 + 32 + 12);
  for (let p = 0; p < length; p++) sum = (sum + data[naming + p] * 2 ** (24 - 8 * (p % 4))) >>> 0;
  data.writeUInt32BE(sum, 128 + 12 + 32 + 4);
  assert.throws(() => extractPresentationFont(data), /bounds/);
});

test("rejects non-ASCII signature aliases", () => {
  const source = fixture();
  source[0] |= 128;
  assert.throws(() => extractPresentationFont(source), /TTC collection/);
  const face = fixture();
  face[128] |= 128;
  assert.throws(() => extractPresentationFont(face), /CFF OpenType/);
});
