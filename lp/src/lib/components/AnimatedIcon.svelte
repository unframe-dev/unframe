<script lang="ts">
  import iconUrl from "../../../../assets/icon.svg?url";

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
  <img class="icon-half icon-top" src={iconUrl} alt="" />
  <img class="icon-half icon-bottom" src={iconUrl} alt="" />
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
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
    pointer-events: none;
  }

  .icon-top {
    clip-path: inset(0 0 50% 0);
    animation: reveal-from-top var(--animation-duration) cubic-bezier(0.65, 0, 0.35, 1)
      var(--animation-delay) both;
  }

  .icon-bottom {
    clip-path: inset(50% 0 0 0);
    animation: reveal-from-bottom var(--animation-duration) cubic-bezier(0.65, 0, 0.35, 1)
      var(--animation-delay) both;
  }

  @keyframes reveal-from-top {
    from {
      clip-path: inset(0 0 100% 0);
    }
    to {
      clip-path: inset(0 0 50% 0);
    }
  }

  @keyframes reveal-from-bottom {
    from {
      clip-path: inset(100% 0 0 0);
    }
    to {
      clip-path: inset(50% 0 0 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .icon-half {
      animation: none;
    }
  }
</style>
