<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section class="bg-background px-6 py-32 sm:px-10 sm:py-44 lg:px-14">
  <div class="mx-auto max-w-[1440px]">
    <SectionLabel index="04">必要な瞬間のために</SectionLabel>
    <div class="mt-12 flex flex-col justify-between gap-10 lg:flex-row lg:items-end">
      <h2 class="display-heading max-w-3xl text-[clamp(3.2rem,7vw,7rem)]">When the idea needs more than a <span class="text-gradient">rectangle.</span></h2>
      <p class="max-w-xs text-sm leading-7 text-muted">最初のラフな思考から、最後に共有するビジョンまで。対話の全体像を見失わないために。</p>
    </div>

    <div class="mt-24 grid border-y border-line md:grid-cols-3">
      <article class="group border-b border-line py-8 md:border-b-0 md:border-r md:pr-10">
        <span class="text-gradient text-xs font-medium">/ 01</span>
        <h3 class="mt-24 text-2xl font-medium tracking-[-0.045em]">空間で語る</h3>
        <p class="mt-4 max-w-xs text-sm leading-7 text-muted">複雑なシステムに余白を与え、要素同士のつながりを見せる。</p>
        <a class="mt-8 inline-flex items-center gap-2 text-xs font-medium text-night/55 transition group-hover:text-brand-purple" href="#contact">クリエイター向け <ArrowUpRight size={14} strokeWidth={1.4} /></a>
      </article>
      <article class="group border-b border-line py-8 md:border-b-0 md:border-r md:px-10">
        <span class="text-gradient text-xs font-medium">/ 02</span>
        <h3 class="mt-24 text-2xl font-medium tracking-[-0.045em]">リアルタイムの協働</h3>
        <p class="mt-4 max-w-xs text-sm leading-7 text-muted">同じ視点を共有することから、よりよい対話を始める。</p>
        <a class="mt-8 inline-flex items-center gap-2 text-xs font-medium text-night/55 transition group-hover:text-brand-purple" href="#contact">チーム向け <ArrowUpRight size={14} strokeWidth={1.4} /></a>
      </article>
      <article class="group py-8 md:pl-10">
        <span class="text-gradient text-xs font-medium">/ 03</span>
        <h3 class="mt-24 text-2xl font-medium tracking-[-0.045em]">没入型の学び</h3>
        <p class="mt-4 max-w-xs text-sm leading-7 text-muted">抽象的な情報を、人が歩き回り、記憶できるものへ変える。</p>
        <a class="mt-8 inline-flex items-center gap-2 text-xs font-medium text-night/55 transition group-hover:text-brand-purple" href="#contact">教育向け <ArrowUpRight size={14} strokeWidth={1.4} /></a>
      </article>
    </div>
  </div>
</section>
