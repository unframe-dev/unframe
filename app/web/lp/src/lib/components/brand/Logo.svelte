<script lang="ts">
  import iconUrl from "#lib/assets/brand/icon.svg?url";
  import Wordmark from "./Wordmark.svelte";

  let { compact = false, class: className = "" }: {
    compact?: boolean;
    class?: string;
  } = $props();
</script>

<a
  class={`group inline-flex items-center gap-[0.17em] text-[2.25rem] leading-none ${className}`}
  href="/"
  aria-label="Unframe home"
>
  <img
    src={iconUrl}
    alt=""
    width="34"
    height="34"
    class="h-[0.78em] w-[0.78em] shrink-0 object-contain transition duration-300 group-hover:rotate-6"
  />
  {#if !compact}
    <Wordmark />
  {/if}
</a>
