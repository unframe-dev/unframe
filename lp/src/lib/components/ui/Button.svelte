<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "primary" | "accent" | "outline" | "quiet";
  type Size = "sm" | "md" | "lg";

  type ButtonProps = {
    children: Snippet;
    class?: string;
    href?: string;
    size?: Size;
    variant?: Variant;
  };

  let {
    children,
    class: className = "",
    href,
    size = "md",
    variant = "primary",
  }: ButtonProps = $props();

  const base =
    "group inline-flex items-center justify-center gap-3 rounded-full border font-medium tracking-[-0.01em] transition duration-300 ease-fluid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-purple";
  const variants: Record<Variant, string> = {
    accent:
      "border-transparent bg-brand-red text-white hover:-translate-y-0.5 hover:bg-brand-red",
    outline:
      "border-current/25 bg-transparent text-current hover:-translate-y-0.5 hover:border-brand-purple hover:text-brand-purple",
    primary:
      "border-transparent bg-night text-white hover:-translate-y-0.5 hover:bg-brand-red",
    quiet:
      "border-transparent bg-transparent px-0 text-current hover:text-brand-purple",
  };
  const sizes: Record<Size, string> = {
    lg: "px-7 py-4 text-sm",
    md: "px-5 py-3 text-sm",
    sm: "px-4 py-2 text-xs",
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
