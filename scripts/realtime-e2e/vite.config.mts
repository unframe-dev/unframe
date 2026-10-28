import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import audience from "../../app/web/audience/vite.config.ts";
import type { Plugin } from "../../app/web/audience/node_modules/vite";

const require = createRequire(new URL("../../app/web/audience/package.json", import.meta.url));
const entry = fileURLToPath(new URL("./browser-entry.ts", import.meta.url));
const bootstrap: Plugin = {
  name: "realtime-e2e-application-entry",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== "/__realtime_e2e") return next();
      void server
        .transformIndexHtml(
          request.url,
          `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@fs${entry}"></script></body></html>`,
        )
        .then((html) => {
          response.setHeader("Content-Type", "text/html");
          response.end(html);
        })
        .catch(next);
    });
  },
};

export default {
  ...audience,
  server: {
    ...audience.server,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.unframe/**",
      ],
    },
  },
  resolve: {
    alias: [
      { find: /^react$/, replacement: require.resolve("react") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
      { find: /^three$/, replacement: require.resolve("three") },
    ],
  },
  plugins: [...(audience.plugins ?? []), bootstrap],
};
