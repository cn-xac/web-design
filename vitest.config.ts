import { fileURLToPath, URL } from "node:url";
import { readFileSync, statSync } from "node:fs";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vite 8 的 SSR 环境不再自动把 Node fs 交给 @vue/compiler-sfc，
 * defineProps<ImportedType>() 需要读文件解析类型，故显式提供。
 * 只实现 compiler-sfc 需要的两个方法，不引入额外依赖。
 */
const isFile = (file: string): boolean => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

const sfcFs = {
  // 必须只认「文件」：existsSync 对目录同样返回 true，
  // 会让 compiler-sfc 把相对目录导入（如 core 的 export * from "./request"）
  // 当成模块文件直接 readFile，抛 EISDIR。
  // 排除目录后，解析器会继续回退到目录下的 index.ts / index.d.ts。
  fileExists: isFile,
  readFile: (file: string) => (isFile(file) ? readFileSync(file, "utf8") : undefined),
};

export default defineConfig({
  plugins: [vue({ script: { fs: sfcFs } })],
  // Vite 8 用 oxc 取代 esbuild；esbuild 选项已废弃，JSX 必须在这里声明。
  // 用对象形态 { runtime: "automatic" }：vue 插件会把 jsx 选项原样传给 oxc，
  // 字符串 "automatic" 会被 oxc 校验拒绝（仅 .tsx 路径会自动转换），对象形态两条路径都合法。
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // 强制去重到本仓的 vue，避免双 Vue 运行时导致 provide/inject 失效
    dedupe: ["vue"],
    // 顺序敏感：前缀更具体的别名必须放在前面
    alias: [
      { find: "@x-ac/web-design-core", replacement: r("./packages/core/src/index.ts") },
      // 顺序敏感：子路径必须先于包别名
      { find: "@x-ac/web-design-react/kit", replacement: r("./packages/react/src/kit.ts") },
      { find: "@x-ac/web-design-react/designer", replacement: r("./packages/react/src/designer.ts") },
      { find: "@x-ac/web-design-react", replacement: r("./packages/react/src/index.ts") },
      // 扩展仓基于适配层 SDK 子入口；必须在 @x-ac/web-design-vue 之前匹配
      { find: "@x-ac/web-design-vue/kit", replacement: r("./packages/vue/src/kit.ts") },
      { find: "@x-ac/web-design-vue/designer", replacement: r("./packages/vue/src/designer.ts") },
      { find: "@x-ac/web-design-vue", replacement: r("./packages/vue/src/index.ts") },
      { find: "@/designer", replacement: r("./packages/vue/src/designer") },
      { find: "@/renderer", replacement: r("./packages/vue/src/renderer") },
      { find: "@/materials", replacement: r("./packages/vue/src/materials") },
      // 测试 fixture（精简 apps 后从 playground/react-demo 迁入 tests/fixtures）
      { find: "@/demo-materials", replacement: r("./tests/fixtures") },
      { find: "@/api", replacement: r("./tests/fixtures") },
      { find: "@/data", replacement: r("./tests/fixtures") },
      { find: "@/fixtures", replacement: r("./tests/fixtures") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
    setupFiles: ["tests/setup.ts"],
    // Vitest 4 起 poolOptions 移除，单文件串行改用顶层 fileParallelism
    pool: "forks",
    fileParallelism: false,
    // 关掉文件系统模块缓存：其清缓存会递归删除 node_modules/.vitest-cache，
    // 在受限沙箱里会触发批量删除保护；CI 里也可按需打开加速冷启动
    fsModuleCache: false,
  },
});
