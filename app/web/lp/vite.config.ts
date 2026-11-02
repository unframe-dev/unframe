import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { mdsvex } from "mdsvex";
import { defineConfig, lazyPlugins } from "vite-plus";

const mdxExtensions = [".md", ".mdx"];

export default defineConfig({
  plugins: lazyPlugins(() => [
    tailwindcss(),
    sveltekit({
      extensions: [".svelte", ...mdxExtensions],
      preprocess: mdsvex({ extensions: mdxExtensions }),
      adapter: adapter({
        pages: "build",
        assets: "build",
        fallback: undefined,
        precompress: true,
        strict: true,
      }),
    }),
  ]),
});
