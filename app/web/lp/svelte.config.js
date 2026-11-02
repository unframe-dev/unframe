import adapter from "@sveltejs/adapter-static";
import { mdsvex } from "mdsvex";

const mdxExtensions = [".md", ".mdx"];

/** @type {import('@sveltejs/kit').Config} */
const config = {
  extensions: [".svelte", ...mdxExtensions],
  preprocess: mdsvex({ extensions: mdxExtensions }),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: undefined,
      precompress: true,
      strict: true,
    }),
  },
};

export default config;
