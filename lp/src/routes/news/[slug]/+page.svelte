<script lang="ts">
  import ContentArticle from "$lib/components/content/ContentArticle.svelte";
  import { newsEntries } from "$lib/content";

  let { data } = $props<{ data: { slug: string } }>();
  const entry = $derived(newsEntries.find((candidate) => candidate.slug === data.slug)!);
</script>

<ContentArticle entry={entry} kind="News" />
