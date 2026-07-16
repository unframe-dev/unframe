import { Client, isFullPage } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.NOTION_TOKEN;
const ROOT = process.env.NOTION_ROOT_PAGE_ID;

if (!TOKEN || !ROOT) {
  console.error("NOTION_TOKEN and NOTION_ROOT_PAGE_ID are required");
  process.exit(1);
}

// 出力先 = リポジトリの docs/notion/ (Notion ミラー専用ディレクトリ)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// scripts/docs/notion-sync/ から リポジトリルートの docs/notion/ へ (3 階層上)
const OUT_DIR = resolve(SCRIPT_DIR, "../../../docs/notion");
const ASSETS_DIR = join(OUT_DIR, ".assets");
// docs/notion/ 配下でクリーンアップ対象から除外するエントリ (ミラー専用なので通常は空)
const PRESERVE_ENTRIES = new Set<string>();

const notion = new Client({ auth: TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

// child_page はディレクトリ階層で表現するので本文からは省く
n2m.setCustomTransformer("child_page", async () => "");

// ページごとに画像トランスフォーマを差し替える (相対パス算出のため出力ディレクトリをキャプチャ)
function configureImageTransformer(pageOutputDir: string): void {
  n2m.setCustomTransformer("image", async (block) => {
    const b = block as { id: string; image?: ImageBlock };
    const image = b.image;
    if (!image) return "";

    const url = image.type === "external" ? image.external.url : image.file.url;
    const caption = (image.caption ?? [])
      .map((t) => t.plain_text)
      .join("")
      .trim();

    const blockId = b.id.replace(/-/g, "");
    let savedRelPath: string | null = null;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = pickExt(res.headers.get("content-type"), url);
      const filename = `${blockId}.${ext}`;
      const filepath = join(ASSETS_DIR, filename);

      if (!existsSync(filepath)) {
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(ASSETS_DIR, { recursive: true });
        await writeFile(filepath, buf);
      }

      // MD 内のリンクは POSIX パスで統一
      savedRelPath = relative(pageOutputDir, filepath).split(sep).join(posix.sep);
    } catch (err) {
      console.warn(`  ! image download failed (${blockId}): ${(err as Error).message}`);
      return `![${caption}](${url} "download failed at sync")`;
    }

    return `![${caption}](${savedRelPath})`;
  });
}

type RichText = { plain_text: string };
type ExternalImage = { type: "external"; external: { url: string }; caption?: RichText[] };
type FileImage = { type: "file"; file: { url: string }; caption?: RichText[] };
type ImageBlock = ExternalImage | FileImage;

function pickExt(contentType: string | null, url: string): string {
  if (contentType) {
    if (contentType.includes("png")) return "png";
    if (contentType.includes("jpeg")) return "jpg";
    if (contentType.includes("gif")) return "gif";
    if (contentType.includes("webp")) return "webp";
    if (contentType.includes("svg")) return "svg";
  }
  const m = url.split("?")[0]?.match(/\.([a-zA-Z0-9]{2,5})$/);
  return m?.[1]?.toLowerCase() ?? "bin";
}

function slugify(title: string): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return cleaned || "untitled";
}

function extractTitle(page: { properties: Record<string, unknown> }): string {
  for (const value of Object.values(page.properties)) {
    const prop = value as { type?: string; title?: RichText[] };
    if (prop.type === "title" && prop.title) {
      const t = prop.title
        .map((x) => x.plain_text)
        .join("")
        .trim();
      if (t) return t;
    }
  }
  return "Untitled";
}

// 与えられたブロック (= ページ または コンテナブロック) の子から child_page を全て収集する。
// synced_block / column / toggle など、has_children を持つラッパーは再帰的に潜って探索する。
async function getChildPageIds(
  blockId: string,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  if (visited.has(blockId)) return [];
  visited.add(blockId);

  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results) {
      if (!("type" in block)) continue;
      if (block.type === "child_page") {
        ids.push(block.id);
        continue;
      }
      // 同期ブロックは duplicate (synced_from あり) なら原本側のブロックを辿る
      if (block.type === "synced_block") {
        const sb = (block as { synced_block?: { synced_from?: { block_id?: string } | null } })
          .synced_block;
        const sourceId = sb?.synced_from?.block_id ?? block.id;
        ids.push(...(await getChildPageIds(sourceId, visited)));
        continue;
      }
      // その他の子持ちブロック (column_list / column / toggle / callout 等)
      if ("has_children" in block && block.has_children) {
        ids.push(...(await getChildPageIds(block.id, visited)));
      }
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return ids;
}

// ルートページ自体に Integration が共有されていない場合の救済。
// Search API で Integration がアクセス可能なページを列挙し、parent.page_id が
// ROOT に一致するものだけ拾う。
async function searchDirectChildren(parentId: string): Promise<string[]> {
  const normalized = parentId.replace(/-/g, "");
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.search({
      filter: { property: "object", value: "page" },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const result of res.results) {
      if (result.object !== "page") continue;
      const parent = (result as { parent?: { type?: string; page_id?: string } }).parent;
      if (parent?.type !== "page_id" || !parent.page_id) continue;
      if (parent.page_id.replace(/-/g, "") === normalized) ids.push(result.id);
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return ids;
}

// ルート直下の子ページ ID を取得。まず blocks.children.list を試し、
// ルート自体にアクセス権がない場合は search にフォールバック。
async function listRootChildren(rootId: string): Promise<string[]> {
  try {
    return await getChildPageIds(rootId);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code !== "object_not_found") throw err;
    console.warn("root page is not shared with the integration; falling back to search API");
    return await searchDirectChildren(rootId);
  }
}

function buildFrontmatter(
  page: { id: string; created_time: string; last_edited_time: string; url: string },
  title: string,
): string {
  return [
    "---",
    `id: ${page.id}`,
    `title: ${JSON.stringify(title)}`,
    `created: ${page.created_time}`,
    `last_edited: ${page.last_edited_time}`,
    `notion_url: ${page.url}`,
    "---",
    "",
  ].join("\n");
}

async function syncPage(pageId: string, parentDir: string, usedSlugs: Set<string>): Promise<void> {
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!isFullPage(page) || page.archived) return;

  const title = extractTitle(page as unknown as { properties: Record<string, unknown> });
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${base}-${suffix++}`;
  usedSlugs.add(slug);

  const childIds = await getChildPageIds(pageId);
  const hasChildren = childIds.length > 0;
  const pageOutputDir = hasChildren ? join(parentDir, slug) : parentDir;
  const outputFile = hasChildren ? join(pageOutputDir, "index.md") : join(parentDir, `${slug}.md`);

  configureImageTransformer(pageOutputDir);

  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const md = n2m.toMarkdownString(mdBlocks).parent ?? "";

  await mkdir(pageOutputDir, { recursive: true });
  await writeFile(outputFile, buildFrontmatter(page, title) + md);
  console.log(`✓ docs/notion/${relative(OUT_DIR, outputFile).split(sep).join(posix.sep)}`);

  if (hasChildren) {
    const childUsedSlugs = new Set<string>();
    for (const childId of childIds) {
      await syncPage(childId, pageOutputDir, childUsedSlugs);
    }
  }
}

async function cleanOutDir(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const entries = await readdir(OUT_DIR);
  await Promise.all(
    entries
      .filter((e) => !PRESERVE_ENTRIES.has(e))
      .map((e) => rm(join(OUT_DIR, e), { recursive: true, force: true })),
  );
}

// ルートページ自身を docs/notion/<slug>.md として書き出す。
// 子ページは同階層に並べる構成なので、ディレクトリではなくフラットなファイルとして保存する。
async function syncRootAsFile(rootId: string, usedSlugs: Set<string>): Promise<void> {
  let page: Awaited<ReturnType<typeof notion.pages.retrieve>>;
  try {
    page = await notion.pages.retrieve({ page_id: rootId });
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "object_not_found") {
      console.warn("root page not accessible to integration; skipping root file");
      return;
    }
    throw err;
  }
  if (!isFullPage(page) || page.archived) return;

  const title = extractTitle(page as unknown as { properties: Record<string, unknown> });
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${base}-${suffix++}`;
  usedSlugs.add(slug);

  configureImageTransformer(OUT_DIR);
  const mdBlocks = await n2m.pageToMarkdown(rootId);
  const md = n2m.toMarkdownString(mdBlocks).parent ?? "";

  const outputFile = join(OUT_DIR, `${slug}.md`);
  await writeFile(outputFile, buildFrontmatter(page, title) + md);
  console.log(`✓ docs/notion/${slug}.md`);
}

async function main(): Promise<void> {
  if (!ROOT) throw new Error("NOTION_ROOT_PAGE_ID is required");

  // 削除も差分に反映させるため、docs/notion/ 配下を毎回作り直す (PRESERVE_ENTRIES を除く)
  await cleanOutDir();

  // 子ページとルートはフラットに同階層へ配置する。slug 重複は usedSlugs で防ぐ。
  const topUsedSlugs = new Set<string>();

  // 1. ルートページ本体を docs/notion/<root-slug>.md として保存 (アクセス権がなければスキップ)
  await syncRootAsFile(ROOT, topUsedSlugs);

  // 2. ルート直下の子ページを docs/notion/ にフラット展開
  const rootChildren = await listRootChildren(ROOT);
  if (rootChildren.length === 0) {
    console.warn("no child pages found under root; check integration's access permissions");
  }
  for (const childId of rootChildren) {
    await syncPage(childId, OUT_DIR, topUsedSlugs);
  }
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
