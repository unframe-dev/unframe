<script lang="ts">
  import ContentIndex from "$lib/components/content/ContentIndex.svelte";
  import { newsEntries } from "$lib/content";
</script>

<ContentIndex
  entries={newsEntries}
  kind="News"
  title="Ideas in motion."
  description="Unframeの現在地、空間的な表現をめぐる考え、プロダクトの舞台裏を記録します。"
/>
