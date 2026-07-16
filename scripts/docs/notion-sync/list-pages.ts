import { Client } from "@notionhq/client";

type RichText = { plain_text?: string };
type PageProperty = { type?: string; title?: RichText[] };
type PageResult = {
  object: "page";
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
};

const TOKEN = process.env.NOTION_TOKEN;

function isPageResult(value: unknown): value is PageResult {
  if (!value || typeof value !== "object") return false;
  const page = value as { object?: unknown; id?: unknown };
  return page.object === "page" && typeof page.id === "string";
}

function extractTitle(properties: Record<string, unknown> | undefined): string {
  for (const value of Object.values(properties ?? {})) {
    const property = value as PageProperty;
    if (property.type !== "title" || !property.title) continue;

    const title = property.title
      .map((text) => text.plain_text ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (title) return title;
  }
  return "Untitled";
}

function normalizePageId(id: string): string {
  const compact = id.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) return id;

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

async function listAccessiblePages(notion: Client): Promise<PageResult[]> {
  const pages: PageResult[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.search({
      filter: { property: "object", value: "page" },
      start_cursor: cursor,
      page_size: 100,
    });

    pages.push(...response.results.filter(isPageResult));
    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return pages.sort((a, b) =>
    extractTitle(a.properties).localeCompare(extractTitle(b.properties), "ja"),
  );
}

async function main(): Promise<void> {
  if (!TOKEN) {
    throw new Error("NOTION_TOKEN is required");
  }

  const pages = await listAccessiblePages(new Client({ auth: TOKEN }));
  if (pages.length === 0) {
    throw new Error(
      "No accessible Notion pages found. Share at least one page with the integration.",
    );
  }

  console.log(`Found ${pages.length} accessible Notion page(s):`);
  for (const [index, page] of pages.entries()) {
    console.log(`${index + 1}. ${extractTitle(page.properties)}`);
    console.log(`   NOTION_ROOT_PAGE_ID=${normalizePageId(page.id)}`);
    console.log(`   URL: ${page.url ?? "(unavailable)"}`);
    console.log(`   last_edited: ${page.last_edited_time ?? "(unavailable)"}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
