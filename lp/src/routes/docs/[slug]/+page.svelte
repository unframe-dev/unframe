<script lang="ts">
  import ContentArticle from "$lib/components/content/ContentArticle.svelte";
  import { docsEntries } from "$lib/content";

  let { data } = $props<{ data: { slug: string } }>();
  const entry = $derived(docsEntries.find((candidate) => candidate.slug === data.slug)!);
</script>

<ContentArticle entry={entry} kind="Docs" />
