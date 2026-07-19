<script lang="ts">
  import { ArrowUpRight, Mail } from "@lucide/svelte";
  import Icon from "@iconify/svelte";
  import Logo from "../brand/Logo.svelte";
  import GradientWave from "../brand/GradientWave.svelte";
</script>

<footer class="relative overflow-hidden bg-[#ececf0] px-6 pb-8 pt-8 text-night sm:px-10 sm:pt-12 lg:px-14">
  <GradientWave id="footer-wave" class="bottom-0 left-0 h-[22rem] opacity-45" />
  <div class="relative mx-auto max-w-[1440px]">
    <div class="flex flex-col justify-between gap-14 border-b border-night/10 pb-16 md:flex-row md:items-end">
      <div>
        <Logo />
        <p class="mt-7 max-w-xs text-sm leading-7 text-night/45 whitespace-nowrap">
          動く余白を必要とするアイデアのための、新しい表現手段。
        </p>
      </div>
      <div class="flex flex-wrap gap-x-10 gap-y-4 text-xs tracking-[0.08em] text-night/55">
        <a class="transition hover:text-night" href="/news/">News</a>
        <a class="transition hover:text-night" href="/docs/">Docs</a>
        <a class="inline-flex items-center gap-2 transition hover:text-night" href="mailto:unframe.dev@gmail.com">
          <Mail size={14} strokeWidth={1.5} /> お問い合わせ
        </a>
        <a class="inline-flex items-center gap-2 transition hover:text-night" href="https://github.com/unframe-dev/unframe">
          <Icon icon="simple-icons:github" width={14} height={14} /> GitHub
          <ArrowUpRight size={12} strokeWidth={1.5} />
        </a>
      </div>
    </div>
    <div class="flex flex-col gap-3 pt-6 text-[0.65rem] tracking-[0.12em] text-night/30 sm:flex-row sm:items-center sm:justify-between">
      <span>© 2026 Unframe</span>
      <span>For spatial thinking</span>
    </div>
  </div>
</footer>
