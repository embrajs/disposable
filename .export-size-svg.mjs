import { pruneBranchesPlugin } from "@embra/esbuild-plugin-prune-branches";
import { defineConfig } from "export-size-svg";

import mangleCache from "./mangle-cache.json" with { type: "json" };

export default defineConfig({
  title: "@embra/disposable",
  out: "./docs/assets",
  esbuildOptions: {
    sourcesContent: false,
    define: {
      __DEV__: "false",
    },
    mangleProps: /[^_]_$/,
    mangleQuoted: true,
    mangleCache,
    plugins: [pruneBranchesPlugin({ __DEV__: false })],
  },
  svg: {
    cardWidth: 400,
    theme: {
      titleColor: "#fb4c1bf7",
      progressColor: "#fb4a1b",
      progressTrackColor: "#fb4c1b37",
    },
  },
  exports: [
    {
      title: "{ scope }",
      code: "export { scope } from './src'",
    },
    {
      title: "{ scope, scopeOne, scopeSet, scopeMap }",
      code: "export { scope, scopeOne, scopeSet, scopeMap } from './src'",
    },
    {
      title: "{ dispose, isDisposable }",
      code: "export { dispose, isDisposable } from './src'",
    },
  ],
});
