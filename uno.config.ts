import { defineConfig, presetUno, transformerDirectives } from "unocss";

/**
 * 设计器样式原子化：构建期工具，下游零新增依赖。
 * 目标是把两端重复的控件皮肤收敛到 shortcuts，构建时展开进产物 CSS。
 * 颜色一律走 var(--wb-*) 设计令牌，保留换肤能力。
 */
export default defineConfig({
  presets: [presetUno()],
  transformers: [transformerDirectives()],
  theme: {
    colors: {
      line: "var(--wb-line)",
      "line-soft": "var(--wb-line-soft)",
      ink: "var(--wb-ink)",
      "ink2": "var(--wb-ink2)",
      "ink3": "var(--wb-ink3)",
      primary: "var(--wb-primary)",
      "primary-soft": "var(--wb-primary-soft)",
      danger: "var(--wb-danger)",
    },
    fontFamily: {
      mono: "var(--wb-mono)",
    },
  },
  shortcuts: {
    /** 原生控件皮肤：仅在回落实现（input/select/textarea）上生效，kit 组件由 UI 库自带皮肤 */
    "wbd-field":
      "border-1 border-solid border-line rounded-5px bg-white text-ink text-12px font-inherit box-border min-w-0 px-2",
    /** 设计器弱按钮：描边 + 轻背景，hover 主色 */
    "wbd-ghost":
      "border-1 border-solid border-line rounded-5px bg-white text-ink2 text-12px font-inherit cursor-pointer px-2 py-1 hover:border-primary hover:text-primary",
    /** 主色按钮 */
    "wbd-primary":
      "border-1 border-solid border-primary rounded-5px bg-primary text-white text-12px font-inherit cursor-pointer px-3 py-1",
    /** 危险/删除小按钮 */
    "wbd-mini":
      "border-0 bg-transparent text-ink3 text-12px font-inherit cursor-pointer px-1 hover:text-danger",
  },
  // 只扫描设计器目录，避免渲染器物料的 class 混进设计器样式
  content: {
    pipeline: {
      include: ["packages/vue/src/designer/**/*.{vue,ts}", "packages/react/src/designer/**/*.{tsx,ts}"],
    },
  },
});
