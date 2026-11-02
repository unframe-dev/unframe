<script lang="ts">
  type GradientWaveProps = {
    id?: string;
    class?: string;
    variant?: "light" | "dark";
    flip?: boolean;
  };

  let {
    id = "brand-wave",
    class: className = "",
    variant = "light",
    flip = false,
  }: GradientWaveProps = $props();

  const paths = [
    "M-80 170 C 140 20, 260 65, 450 250 S 760 560, 1040 350 S 1420 35, 1680 150",
    "M-80 188 C 140 38, 260 83, 450 268 S 760 578, 1040 368 S 1420 53, 1680 168",
    "M-80 206 C 140 56, 260 101, 450 286 S 760 596, 1040 386 S 1420 71, 1680 186",
    "M-80 224 C 140 74, 260 119, 450 304 S 760 614, 1040 404 S 1420 89, 1680 204",
    "M-80 242 C 140 92, 260 137, 450 322 S 760 632, 1040 422 S 1420 107, 1680 222",
    "M-80 260 C 140 110, 260 155, 450 340 S 760 650, 1040 440 S 1420 125, 1680 240",
    "M-80 278 C 140 128, 260 173, 450 358 S 760 668, 1040 458 S 1420 143, 1680 258",
    "M-80 296 C 140 146, 260 191, 450 376 S 760 686, 1040 476 S 1420 161, 1680 276",
    "M-80 314 C 140 164, 260 209, 450 394 S 760 704, 1040 494 S 1420 179, 1680 294",
    "M-80 332 C 140 182, 260 227, 450 412 S 760 722, 1040 512 S 1420 197, 1680 312",
    "M-80 350 C 140 200, 260 245, 450 430 S 760 740, 1040 530 S 1420 215, 1680 330",
    "M-80 368 C 140 218, 260 263, 450 448 S 760 758, 1040 548 S 1420 233, 1680 348",
    "M-80 386 C 140 236, 260 281, 450 466 S 760 776, 1040 566 S 1420 251, 1680 366",
    "M-80 404 C 140 254, 260 299, 450 484 S 760 794, 1040 584 S 1420 269, 1680 384",
    "M-80 422 C 140 272, 260 317, 450 502 S 760 812, 1040 602 S 1420 287, 1680 402",
  ];

  const opacity = $derived(variant === "dark" ? 0.42 : 0.28);
</script>

<svg
  class={`absolute h-full w-full ${flip ? "scale-y-[-1]" : ""} ${className}`}
  viewBox="0 0 1600 800"
  preserveAspectRatio="xMidYMid slice"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <defs>
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7187f5" />
      <stop offset="0.48" stop-color="#9a80d0" />
      <stop offset="1" stop-color="#df7b80" />
    </linearGradient>
  </defs>
  {#each paths as path, index}
    <path
      d={path}
      stroke={`url(#${id})`}
      stroke-width="1"
      opacity={opacity - index * 0.008}
    />
  {/each}
</svg>
