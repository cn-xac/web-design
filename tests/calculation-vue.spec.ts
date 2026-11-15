// @vitest-environment jsdom
/**
 * Vue 侧数据计算：运行时自动回填 + 设计器计算弹窗（rtHicl）。
 * 挂载范式沿用 designer-visibility.spec.ts：CI stub 与本地真实 EP 都能跑。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { SchemaRenderer } from "@x-ac/web-design-vue";
import DesignerView from "@/designer/DesignerView.vue";
import { useDesignerStore } from "@/designer/store";
import { blankTemplate } from "@/data/templates";
import { localStorageRepo, savePage } from "@/api/pageRepo";
import { setPageRepository } from "@x-ac/web-design-vue/designer";
import { SCHEMA_VERSION, type PageSchema } from "@x-ac/web-design-core";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
});

const tick = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let pageId = "";

beforeEach(() => {
  localStorage.clear();
  setPageRepository(localStorageRepo);
  pageId = savePage(blankTemplate("计算测试")).id;
});

const calcConfig = {
  operands: [
    { alias: "A", path: "form.n_price" },
    { alias: "B", path: "form.n_qty" },
  ],
  formula: "ROUND(SUM(A, B), 0)",
};

const runtimePage = (): PageSchema => ({
  schemaVersion: SCHEMA_VERSION,
  id: "page_calc_vue",
  type: "page",
  state: { form: { n_price: 10, n_qty: 2 } },
  children: [
    { id: "n_price", component: "number", props: { label: "单价" } },
    { id: "n_qty", component: "number", props: { label: "数量" } },
    {
      id: "n_total",
      component: "text",
      props: { text: "{{form.n_total}}" },
      calculation: calcConfig,
    },
  ],
});

type ScopeLike = { form: Record<string, unknown> };

describe("Vue 运行时：计算结果自动回填", () => {
  it("挂载即算出结果，参与元素变化后自动重算", async () => {
    const wrapper = mount(SchemaRenderer, { props: { page: runtimePage(), mode: "view" } });
    await tick();
    const scope = (wrapper.vm as unknown as { scope: ScopeLike }).scope;
    expect(scope.form.n_total).toBe(12);

    scope.form.n_price = 7;
    await tick();
    expect(scope.form.n_total).toBe(9);

    // 清空依赖时结果也清空，不会残留旧值
    scope.form.n_qty = "";
    await tick();
    expect(scope.form.n_total).toBe("");
    wrapper.unmount();
  });

  it("重复渲染不会把计算结果写进 Schema，只在运行时 scope 生效", () => {
    const page = runtimePage();
    expect(page.state?.form).toEqual({ n_price: 10, n_qty: 2 });
    expect(page.children[2].calculation?.formula).toBe("ROUND(SUM(A, B), 0)");
  });
});

async function mountDesigner() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(DesignerView, { props: { pageId }, global: { plugins: [pinia] } });
  await tick(60);
  const store = useDesignerStore(pinia);
  store.setPage({
    ...blankTemplate("计算测试"),
    children: [
      { id: "f1", component: "text", props: { label: "合计" } },
      { id: "f2", component: "number", props: { label: "数量" } },
    ],
  });
  store.select("f1");
  await tick();
  return { wrapper, store };
}

async function openCalculationDialog(wrapper: Awaited<ReturnType<typeof mountDesigner>>["wrapper"]) {
  const styleTab = wrapper.findAll(".inspector__tab").find((tab) => tab.text().includes("样式"));
  expect(styleTab).toBeTruthy();
  await styleTab!.trigger("click");
  await tick();
  await wrapper.find(".style__calc-btn").trigger("click");
  await tick();
}

describe("Vue 设计器：数据计算弹窗", () => {
  it("属性面板头部有「高级计算」入口，点击直接打开配置弹窗", async () => {
    const { wrapper } = await mountDesigner();
    // 默认就是「属性」Tab，不需要先切到「样式」
    const entry = wrapper.find(".props__calc");
    expect(entry.exists()).toBe(true);
    expect(entry.text()).toContain("高级计算");
    await entry.trigger("click");
    await tick();
    expect(wrapper.find(".wbd-modal__title").text()).toContain("配置高级计算");
    wrapper.unmount();
  });

  it("选参与元素 + 高级函数算式 → 保存后写入 node.calculation，并自动给文字元素绑定结果", async () => {
    const { wrapper, store } = await mountDesigner();
    await openCalculationDialog(wrapper);

    expect(wrapper.find(".wbd-modal__title").text()).toContain("配置高级计算");
    expect(wrapper.findAll(".calc__fn").length).toBeGreaterThan(10);

    await wrapper.find(".calc__element").setValue("form.f2");
    await wrapper.find(".calc__formula").setValue("ROUND(A * 1.5, 1)");
    await wrapper.find(".calc__ok").trigger("click");
    await tick();

    const node = store.page.children[0];
    expect(node.calculation).toMatchObject({
      formula: "ROUND(A * 1.5, 1)",
      operands: [{ alias: "A", path: "form.f2" }],
    });
    // 文字元素没有 modelValue，保存时自动把正文绑到回填路径
    expect(node.props?.text).toBe("{{form.f1}}");
    wrapper.unmount();
  });

  it("插入函数按钮把签名写进算式；移除计算按钮删除配置", async () => {
    const { wrapper, store } = await mountDesigner();
    await openCalculationDialog(wrapper);
    await wrapper.find(".calc__element").setValue("form.f2");

    const sumButton = wrapper.findAll(".calc__fn").find((button) => button.text() === "SUM");
    expect(sumButton).toBeTruthy();
    await sumButton!.trigger("click");
    expect((wrapper.find(".calc__formula").element as HTMLTextAreaElement).value).toContain("SUM(");

    await wrapper.find(".calc__ok").trigger("click");
    await tick();
    expect(store.page.children[0].calculation?.formula).toContain("SUM(");

    await openCalculationDialog(wrapper);
    await wrapper.find(".calc__clear").trigger("click");
    await tick();
    expect(store.page.children[0].calculation).toBeUndefined();
    wrapper.unmount();
  });

  it("悬停函数按钮显示参数、返回值与示例说明", async () => {
    const { wrapper } = await mountDesigner();
    await openCalculationDialog(wrapper);
    expect(wrapper.find(".calc__fn-help--empty").exists()).toBe(true);

    const round = wrapper.findAll(".calc__fn").find((button) => button.text() === "ROUND");
    expect(round).toBeTruthy();
    await round!.trigger("mouseenter");

    const help = wrapper.find(".calc__fn-help");
    expect(help.text()).toContain("ROUND(A, 2)");
    expect(help.text()).toContain("参数");
    expect(help.text()).toContain("返回");
    expect(help.text()).toContain("示例");
    expect(help.text()).toContain("1.235");
    wrapper.unmount();
  });

  it("点问号打开完整使用说明弹窗，ESC 只关说明层、不丢计算草稿", async () => {
    const { wrapper } = await mountDesigner();
    await openCalculationDialog(wrapper);
    await wrapper.find(".calc__formula").setValue("A * 2");

    const helpButton = wrapper.find(".calc__help-btn");
    expect(helpButton.exists()).toBe(true);
    await helpButton.trigger("click");
    await tick();

    // 说明弹窗 Teleport 到 body，用 document 查询而不是 wrapper.find
    const help = document.body.querySelector(".calc__help");
    expect(help).toBeTruthy();
    expect(document.body.querySelectorAll(".calc__help-fn")).toHaveLength(18);
    expect(help!.textContent).toContain("一、通用规则");
    expect(help!.textContent).toContain("二、函数参考");
    expect(help!.textContent).toContain("三、常见业务配方");
    expect(help!.textContent).toContain("四、限制与排错");
    expect(
      [...document.body.querySelectorAll(".wbd-modal__title")].some((title) =>
        (title.textContent ?? "").includes("高级函数使用说明"),
      ),
    ).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(document.body.querySelector(".calc__help")).toBeNull();
    // 外层计算弹窗仍在，草稿没被 ESC 一起关掉
    expect(wrapper.find(".calc__formula").exists()).toBe(true);
    expect((wrapper.find(".calc__formula").element as HTMLTextAreaElement).value).toBe("A * 2");
    wrapper.unmount();
  });

  it("非文字 / 数字元素的计算入口禁用", async () => {
    const { wrapper, store } = await mountDesigner();
    store.select("f2");
    store.setPage({
      ...store.page,
      children: [...store.page.children, { id: "f3", component: "container", props: {} }],
    });
    store.select("f3");
    await tick();

    const styleTab = wrapper.findAll(".inspector__tab").find((tab) => tab.text().includes("样式"));
    await styleTab!.trigger("click");
    await tick();
    expect((wrapper.find(".style__calc-btn").element as HTMLButtonElement).disabled).toBe(true);
    wrapper.unmount();
  });
});
