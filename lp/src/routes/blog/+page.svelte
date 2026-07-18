<script lang="ts">
  import ContentIndex from "$lib/components/content/ContentIndex.svelte";
  import { blogEntries } from "$lib/content";
</script>

<ContentIndex
  entries={blogEntries}
  kind="Blog"
  title="Ideas in motion."
  description="Unframeの現在地、空間的な表現をめぐる考え、プロダクトの舞台裏を記録します。"
/>
