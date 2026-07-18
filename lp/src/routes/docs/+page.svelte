<script lang="ts">
  import ContentIndex from "$lib/components/content/ContentIndex.svelte";
  import { docsEntries } from "$lib/content";
</script>

<ContentIndex
  entries={docsEntries}
  kind="Docs"
  title="Make room for context."
  description="Unframeで空間的なプレゼンテーションをつくるためのガイドとリファレンスです。"
/>
