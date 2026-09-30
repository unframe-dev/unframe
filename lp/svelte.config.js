import adapter from "@sveltejs/adapter-static";
import { mdsvex } from "mdsvex";

const mdxExtensions = [".md", ".mdx"];

/** @type {import('@sveltejs/kit').Config} */
const config = {
  extensions: [".svelte", ...mdxExtensions],
  kit: {
    adapter: adapter({
      assets: "build",
      fallback: undefined,
      pages: "build",
      precompress: true,
      strict: true,
    }),
  },
  preprocess: mdsvex({ extensions: mdxExtensions }),
};

export default config;
