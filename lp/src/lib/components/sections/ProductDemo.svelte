<script lang="ts">
  import { ArrowUpRight, Play, Plus } from "@lucide/svelte";
  import GradientWave from "../brand/GradientWave.svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="demo" class="relative overflow-hidden bg-[#ececf0] px-6 py-32 text-night sm:px-10 sm:py-44 lg:px-14">
  <GradientWave id="demo-wave" class="-right-32 top-0 h-full w-[120%] opacity-45" />
  <div class="relative mx-auto max-w-[1440px]">
    <div class="flex flex-col justify-between gap-10 sm:flex-row sm:items-end">
      <div>
      <SectionLabel index="03">動きの中で</SectionLabel>
        <h2 class="display-heading mt-10 max-w-2xl text-[clamp(3.2rem,7vw,7rem)]">A presentation you can <span class="text-gradient">enter.</span></h2>
      </div>
      <a class="group inline-flex items-center gap-3 text-sm text-night/55 transition hover:text-night" href="#contact">
        先行デモを見る
        <ArrowUpRight size={16} strokeWidth={1.5} class="transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </a>
    </div>

    <div class="relative mt-16 aspect-[16/9] overflow-hidden rounded-[1.25rem] border border-night/15 bg-white/65 shadow-xl sm:mt-24">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_34%_30%,rgba(113,135,245,0.14),transparent_28%),radial-gradient(circle_at_78%_68%,rgba(223,123,128,0.11),transparent_34%)]"></div>
      <div class="absolute left-[9%] top-[16%] h-[52%] w-[46%] rounded-[0.5rem] border border-brand-blue/55 bg-brand-blue/[0.04] shadow-[0_0_80px_rgba(113,135,245,0.12)] transition duration-700 hover:translate-x-3 hover:translate-y-2">
        <div class="absolute -left-2 -top-2 h-4 w-4 border-l border-t border-brand-blue"></div>
        <div class="absolute -bottom-2 -right-2 h-4 w-4 border-b border-r border-brand-red"></div>
        <div class="absolute left-7 top-7 text-[0.55rem] uppercase tracking-[0.2em] text-night/40">空間キャンバス / 01</div>
        <div class="absolute bottom-7 left-7 max-w-[10rem] text-2xl font-light leading-[1.05] tracking-[-0.06em] text-night/75 sm:text-4xl">Ideas have an axis.</div>
      </div>
      <div class="absolute right-[11%] top-[21%] h-[38%] w-[24%] rounded-[0.45rem] border border-brand-red/40 bg-brand-red/[0.04] transition duration-700 hover:-translate-x-2 hover:translate-y-2">
        <div class="absolute inset-4 border border-night/10"></div>
        <div class="absolute bottom-5 left-5 right-5 h-px bg-gradient-to-r from-brand-blue to-brand-red"></div>
      </div>
      <div class="absolute bottom-[12%] left-[20%] flex items-center gap-3 text-[0.55rem] uppercase tracking-[0.2em] text-night/35">
        <span class="h-1.5 w-1.5 rounded-full bg-brand-red"></span> 現在の視点
      </div>
      <div class="absolute bottom-7 right-7 hidden items-center gap-2 text-[0.55rem] uppercase tracking-[0.2em] text-night/35 sm:flex">
        <Plus size={12} strokeWidth={1.2} /> レイヤーを追加
      </div>
      <a class="group absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-night/25 bg-white/50 text-night backdrop-blur-md transition duration-300 hover:scale-105 hover:bg-night hover:text-white" href="#contact" aria-label="プロダクトデモを申し込む">
        <Play size={18} fill="currentColor" strokeWidth={1.3} class="ml-1" />
      </a>
    </div>
  </div>
</section>
