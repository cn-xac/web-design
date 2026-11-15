/**
 * 引擎测试用的最小 UI 适配器（零 UI 库依赖）。
 *
 * 引擎本身不绑定任何 UI 库：渲染器需要一个适配包提供组件实现。
 * 这里用 core 的通用物料清单 + 空组件表构造一个测试适配器，
 * 让 core / vue / react 三包自身的用例在不安装任何 UI 库的情况下也能挂载。
 *
 * components 置空是刻意的：渲染器对未实现的物料会降级为占位块，
 * 这正是「不白屏」「未知组件保留子节点」等兜底用例需要的形态。
 * 需要真实控件的用例属于各适配包自己的测试，归各自仓库，不在本仓重复。
 */
import { MATERIALS, type Material } from "@x-ac/web-design-core";

export const testAdapter = {
  name: "test-adapter",
  materials: MATERIALS,
  components: {} as Record<string, unknown>,
  actions: {},
};

export const testMaterials: Material[] = MATERIALS;

/** 字段补丁表：引擎测试没有适配包专有字段 */
export const TEST_FIELD_PATCHES: Record<string, never[]> = {};
