<script lang="ts">
  import { Box, Layers3, ScanLine } from "@lucide/svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="features" class="bg-background px-6 pb-36 sm:px-10 sm:pb-48 lg:px-14">
  <div class="mx-auto max-w-[1440px]">
    <div class="grid gap-14 lg:grid-cols-[0.55fr_1.45fr] lg:gap-20">
      <div>
        <SectionLabel index="02">構成要素</SectionLabel>
        <p class="mt-7 max-w-xs text-sm leading-7 text-muted">デッキではなく、ひとつの場所として感じられるプレゼンテーションに必要なもの。</p>
      </div>
      <div class="border-t border-line">
        <article class="group grid gap-5 border-b border-line py-9 sm:grid-cols-[4rem_1fr_1.5fr] sm:gap-8">
          <span class="text-gradient text-sm font-medium">01</span>
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-2xl font-medium tracking-[-0.045em]">奥行きで構成する</h3>
              <p class="mt-3 text-sm leading-6 text-muted sm:hidden">コンテンツを本当の空間的な関係性で配置する。</p>
            </div>
            <Box size={24} strokeWidth={1.1} class="shrink-0 text-brand-blue transition duration-500 group-hover:rotate-12" />
          </div>
          <p class="hidden max-w-sm self-center text-sm leading-7 text-muted sm:block">コンテンツを本当の空間的な関係性で配置する。すべてのレイヤーに、それぞれの場所とスケール、瞬間を与える。</p>
        </article>
        <article class="group grid gap-5 border-b border-line py-9 sm:grid-cols-[4rem_1fr_1.5fr] sm:gap-8">
          <span class="text-gradient text-sm font-medium">02</span>
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-2xl font-medium tracking-[-0.045em]">視点を導く</h3>
              <p class="mt-3 text-sm leading-6 text-muted sm:hidden">物語を平坦にせず、意識を向ける先をつくる。</p>
            </div>
            <ScanLine size={24} strokeWidth={1.1} class="shrink-0 text-brand-purple transition duration-500 group-hover:translate-x-1" />
          </div>
          <p class="hidden max-w-sm self-center text-sm leading-7 text-muted sm:block">物語を平坦にせず、意識を向ける先をつくる。複雑なアイデアの中に、意図した道筋を描く。</p>
        </article>
        <article class="group grid gap-5 border-b border-line py-9 sm:grid-cols-[4rem_1fr_1.5fr] sm:gap-8">
          <span class="text-gradient text-sm font-medium">03</span>
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-2xl font-medium tracking-[-0.045em]">存在する余白をつくる</h3>
              <p class="mt-3 text-sm leading-6 text-muted sm:hidden">同じアイデアを、同じ場所で分かち合う。</p>
            </div>
            <Layers3 size={24} strokeWidth={1.1} class="shrink-0 text-brand-red transition duration-500 group-hover:-translate-y-1" />
          </div>
          <p class="hidden max-w-sm self-center text-sm leading-7 text-muted sm:block">同じアイデアを、同じ場所で分かち合う。同じ空間から発表し、レビューし、理解する。</p>
        </article>
      </div>
    </div>
  </div>
</section>
