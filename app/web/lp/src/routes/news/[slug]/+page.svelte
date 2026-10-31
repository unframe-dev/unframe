<script lang="ts">
  import { browser } from "$app/environment";
  import { page } from "$app/state";
  import ContentArticle from "$lib/components/content/ContentArticle.svelte";
  import { newsEntries } from "$lib/content";
  import { getNewsSource } from "$lib/news-navigation";

  let { data } = $props<{ data: { slug: string } }>();
  const entry = $derived(newsEntries.find((candidate) => candidate.slug === data.slug)!);
  const source = $derived(
    browser ? getNewsSource(new URLSearchParams(page.url.search).get("from")) : "news",
  );
</script>

<ContentArticle entry={entry} kind="News" source={source} />
