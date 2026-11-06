<script lang="ts">
  import { Box, Hand, Smartphone } from "@lucide/svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="features" class="bg-background px-6 pb-36 sm:px-10 sm:pb-48 lg:px-14">
  <div class="mx-auto max-w-[1440px]">
    <div class="grid gap-14 lg:grid-cols-[0.55fr_1.45fr] lg:gap-20">
      <div>
        <SectionLabel index="02">機能</SectionLabel>
        <p class="mt-7 max-w-xs text-sm leading-7 text-muted">容易にプレゼンテーションを作成し、<br/>発表まで一貫してできます。</p>
      </div>
      <div class="border-t border-line">
        <article class="group grid gap-5 border-b border-line py-9 sm:grid-cols-[4rem_1fr_1.5fr] sm:gap-8">
          <span class="text-gradient text-sm font-medium">01</span>
          <div class="flex items-start justify-between gap-4">
            <h3 class="text-2xl font-medium tracking-[-0.045em]">空間をつくる</h3>
            <Box size={24} strokeWidth={1.1} class="shrink-0 text-brand-blue transition duration-500 group-hover:rotate-12" />
          </div>
          <p class="max-w-sm self-center text-sm leading-7 text-muted">3Dモデルや画像、テキストを配置し、Local Editorのプレビューで見え方や演出の流れを確認できます。</p>
        </article>
        <article class="group grid gap-5 border-b border-line py-9 sm:grid-cols-[4rem_1fr_1.5fr] sm:gap-8">
          <span class="text-gradient text-sm font-medium">02</span>
          <div class="flex items-start justify-between gap-4">
            <h3 class="text-2xl font-medium tracking-[-0.045em]">動きで演出を始める</h3>
            <Hand size={24} strokeWidth={1.1} class="shrink-0 text-brand-purple transition duration-500 group-hover:translate-x-1" />
          </div>
          <p class="max-w-sm self-center text-sm leading-7 text-muted">発表者が指定したエリアに入ったり、手をスワイプしたりすると、設定した演出が始まります。</p>
        </article>
        <article class="group grid gap-5 border-b border-line py-9 sm:grid-cols-[4rem_1fr_1.5fr] sm:gap-8">
          <span class="text-gradient text-sm font-medium">03</span>
          <div class="flex items-start justify-between gap-4">
            <h3 class="text-2xl font-medium tracking-[-0.045em]">スマートフォンで視聴する</h3>
            <Smartphone size={24} strokeWidth={1.1} class="shrink-0 text-brand-red transition duration-500 group-hover:-translate-y-1" />
          </div>
          <p class="max-w-sm self-center text-sm leading-7 text-muted">観客はブラウザでルームに参加し、会場のマーカーにカメラを向けて位置を合わせると、発表の進行に合わせて空間に表示される資料を見られます。</p>
        </article>
      </div>
    </div>
  </div>
</section>
