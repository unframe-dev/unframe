# React Component Authoring 型試作

`api.d.ts` は提案 API の型宣言だけであり、実行可能な SDK ではありません。`hero.tsx`、`reveal.tsx`、`presentation.ts` は `docs/packages/REACT_COMPONENT_AUTHORING.md` の三例から、import を試作 API に差し替え、型検査対象外の CSS import を除いた fixture です。JSX は `app/web` にインストール済みの React 19 型を使用します。

```sh
pnpm --filter @unframe/unframe-authoring exec tsc --noEmit -p prototypes/react-component/tsconfig.json
```

`type-contract.tsx` は排他的な必須・default 付き Prop、異種 scene の Props、文字列 Prop 参照、default 解決後の render 入力、同期 render、State helper の型を検査します。`@ts-expect-error` は拒否箇所を固定します。型検査では runtime validation、State 別 binding の出現、Flow 参照の存在、DOM/capture の正しさは確認できません。特に `flow` はこの試作では `object` であり、既存 Compiler の参照検証に委ねます。これらは後続の抽出・Compiler・capture 検証が必要です。
