<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    index,
    children,
    tone = "light",
  } = $props<{
    index: string;
    children: Snippet;
    tone?: "light" | "dark";
  }>();
</script>

<div class={`eyebrow inline-flex items-center gap-3 ${tone === "dark" ? "text-white/55" : "text-night/50"}`}>
  <span class="text-gradient">{index}</span>
  <span class={`h-px w-8 ${tone === "dark" ? "bg-white/20" : "bg-night/20"}`}></span>
  <span>{@render children()}</span>
</div>
