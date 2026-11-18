import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import UnoCSS from "unocss/vite";

/**
 * 库模式构建：
 * - index  → 渲染器（不含设计器、不含 pinia 运行时依赖）
 * - designer → 设计器（按需引入）
 * - kit    → 扩展仓适配层 SDK（纯 TS，不加载渲染器 / CSS / pinia）
 * - 宿主依赖全部 external，避免把 Vue / Element Plus 打进产物
 */
export default defineConfig({
  plugins: [
    vue(),
    // 原子类在构建期展开进 style.css；下游不依赖 unocss 运行时
    // 配置由 unocss 从项目根自动发现（uno.config.ts），不显式传 Windows 路径
    UnoCSS(),
    dts({
      tsconfigPath: "./tsconfig.json",
      entryRoot: "src",
      include: ["src/**/*.ts", "src/**/*.vue"],
      insertTypesEntry: false,
      copyDtsFiles: false,
    }),
  ],
  resolve: {
    alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
  },
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        designer: fileURLToPath(new URL("./src/designer.ts", import.meta.url)),
        kit: fileURLToPath(new URL("./src/kit.ts", import.meta.url)),
      },
      formats: ["es"],
    },
    cssCodeSplit: false,
    sourcemap: true,
    // 清理由 scripts/clean-dist.mjs 负责（跨平台，不受 shell 删除限制）
    emptyOutDir: false,
    rollupOptions: {
      external: ["vue", "pinia", "@x-ac/web-design-core"],
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "style.css",
      },
    },
  },
});
