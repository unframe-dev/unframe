<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "primary" | "accent" | "outline" | "quiet";
  type Size = "sm" | "md" | "lg";

  type ButtonProps = {
    href?: string;
    variant?: Variant;
    size?: Size;
    class?: string;
    children: Snippet;
  };

  let {
    href,
    variant = "primary",
    size = "md",
    class: className = "",
    children,
  }: ButtonProps = $props();

  const base =
    "group inline-flex items-center justify-center gap-3 rounded-full border font-medium tracking-[-0.01em] transition duration-300 ease-fluid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-purple";
  const variants: Record<Variant, string> = {
    primary:
      "border-transparent bg-night text-white hover:-translate-y-0.5 hover:bg-brand-red",
    accent:
      "border-transparent bg-brand-red text-white hover:-translate-y-0.5 hover:bg-brand-red",
    outline:
      "border-current/25 bg-transparent text-current hover:-translate-y-0.5 hover:border-brand-purple hover:text-brand-purple",
    quiet:
      "border-transparent bg-transparent px-0 text-current hover:text-brand-purple",
  };
  const sizes: Record<Size, string> = {
    sm: "px-4 py-2 text-xs",
    md: "px-5 py-3 text-sm",
    lg: "px-7 py-4 text-sm",
  };
  const classes = $derived(`${base} ${variants[variant]} ${sizes[size]} ${className}`);
</script>

{#if href}
  <a class={classes} href={href}>
    {@render children()}
  </a>
{:else}
  <button class={classes} type="button">
    {@render children()}
  </button>
{/if}
