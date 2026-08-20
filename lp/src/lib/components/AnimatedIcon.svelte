<script lang="ts">
  import iconUrl from "$lib/assets/brand/icon.svg?url";

  type AnimatedIconProps = {
    alt?: string;
    class?: string;
    size?: string;
    duration?: string;
    delay?: string;
  };

  let {
    alt = "",
    class: className = "",
    size = "10rem",
    duration = "1.4s",
    delay = "0s",
  }: AnimatedIconProps = $props();
</script>

<span
  class={`animated-icon ${className}`}
  style={`--icon-size: ${size}; --animation-duration: ${duration}; --animation-delay: ${delay};`}
  role={alt ? "img" : undefined}
  aria-label={alt || undefined}
  aria-hidden={alt ? undefined : "true"}
>
  <span class="icon-half icon-top">
    <img src={iconUrl} alt="" />
  </span>
  <span class="icon-half icon-bottom">
    <img src={iconUrl} alt="" />
  </span>
</span>

<style>
  .animated-icon {
    display: inline-block;
    position: relative;
    width: var(--icon-size);
    height: var(--icon-size);
    overflow: hidden;
  }

  .icon-half {
    position: absolute;
    left: 0;
    display: block;
    width: 100%;
    height: 50%;
    overflow: hidden;
    user-select: none;
    pointer-events: none;
  }

  .icon-half img {
    position: absolute;
    display: block;
    width: 100%;
    height: var(--icon-size);
    object-fit: contain;
    user-select: none;
    pointer-events: none;
  }

  .icon-bottom img {
    bottom: 0;
  }

  .icon-top {
    top: 0;
    animation: reveal-from-top var(--animation-duration) cubic-bezier(0.65, 0, 0.35, 1)
      var(--animation-delay) both;
  }

  .icon-bottom {
    bottom: 0;
    animation: reveal-from-bottom var(--animation-duration) cubic-bezier(0.65, 0, 0.35, 1)
      var(--animation-delay) both;
  }

  @keyframes reveal-from-top {
    from {
      height: 0;
    }
    to {
      height: 50%;
    }
  }

  @keyframes reveal-from-bottom {
    from {
      height: 0;
    }
    to {
      height: 50%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .icon-half {
      animation: none;
    }
  }
</style>
