/**
 * 测试全局装配。
 *
 * 引擎不认识任何 UI 库：渲染必须由适配包提供组件实现。
 * 所以这里统一注入一个零依赖的测试适配器，测试文件本身只关心 Schema 与断言。
 * core 的纯函数用例跑在 node 环境下（没有 document），跳过注入即可。
 */
import { config } from "@vue/test-utils";
import { testAdapter } from "./fixtures/test-adapter";

// React 19 起 act() 要求显式声明测试环境，否则每个用例都会刷一条警告。
// 统一在全局 setup 里声明，测试文件不必各自重复。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof document !== "undefined") {
  // 动态加载：core 的纯函数用例跑在 node 环境，不该被强拉进 Vue 运行时
  const { UI_ADAPTER } = await import("@x-ac/web-design-vue");
  config.global.provide = {
    ...(config.global.provide ?? {}),
    [UI_ADAPTER as symbol]: testAdapter,
  };
}
