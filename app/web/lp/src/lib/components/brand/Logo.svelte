<script lang="ts">
  import iconUrl from "$lib/assets/brand/icon.svg?url";

  let { compact = false, class: className = "" } = $props<{
    compact?: boolean;
    class?: string;
  }>();
</script>

<a
  class={`group inline-flex items-center gap-3 ${className}`}
  href="/"
  aria-label="Unframe home"
>
  <img
    src={iconUrl}
    alt=""
    width="34"
    height="34"
    class="h-8 w-8 object-contain transition duration-300 group-hover:rotate-6"
  />
  {#if !compact}
    <span class="font-display text-[1.7rem] font-light tracking-[-0.065em] text-night">Unframe</span>
  {/if}
</a>
