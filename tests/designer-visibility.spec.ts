// @vitest-environment jsdom
/**
 * 设计器条件配置弹窗端到端验证（真实点击，不 mock 组件）。
 * 与 designer-bindings.spec.ts 同一套挂载方式：CI stub 与本地真实 EP 都能跑。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import DesignerView from "@/designer/DesignerView.vue";
import { useDesignerStore } from "@/designer/store";
import { blankTemplate } from "@/data/templates";
import { localStorageRepo, savePage } from "@/api/pageRepo";
import { setPageRepository } from "@x-ac/web-design-vue/designer";
import { collectConditionElements, type NodeSchema, type PageSchema } from "@x-ac/web-design-core";

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
  pageId = savePage(blankTemplate("显隐测试")).id;
});

/** 放两个节点：目标自身 + 一个可作为条件左元素的字段 */
async function mountWithNodes(target: NodeSchema) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(DesignerView, {
    props: { pageId },
    global: { plugins: [pinia] },
  });
  await tick(60);

  const store = useDesignerStore(pinia);
  store.setPage({
    ...blankTemplate("显隐测试"),
    children: [target, { id: "f2", component: "input", props: { label: "部门" } }],
  });
  store.select(target.id);
  await tick(40);
  return { wrapper, store };
}

async function openConditionDialog(wrapper: Awaited<ReturnType<typeof mountWithNodes>>["wrapper"]) {
  const tabs = wrapper.findAll(".inspector__tab");
  const styleTab = tabs.find((tab) => tab.text().includes("样式"));
  expect(styleTab).toBeTruthy();
  await styleTab!.trigger("click");
  await tick();

  // 1.3.0 起条件只有一个入口（数据计算入口按专属选择器排除）
  const buttons = wrapper.findAll(".style__cond-btn:not(.style__calc-btn)");
  expect(buttons).toHaveLength(1);
  await buttons[0].trigger("click");
  await tick();
}

describe("设计器：显示 / 隐藏条件弹窗", () => {
  it("打开弹窗、选左元素与关系、默认 action=show 写回 node.visibility", async () => {
    const { wrapper, store } = await mountWithNodes({
      id: "f1",
      component: "input",
      props: { label: "姓名" },
    });

    await openConditionDialog(wrapper);
    expect(wrapper.find(".wbd-modal__title").text()).toContain("配置显示 / 隐藏条件");
    expect(wrapper.findAll(".cond__row")).toHaveLength(1);

    await wrapper.find(".cond__left").setValue("form.f2");
    await wrapper.find(".cond__value").setValue("sales");
    await wrapper.find(".cond__ok").trigger("click");
    await tick();

    const visibility = store.page.children[0].visibility;
    expect(visibility?.action).toBe("show");
    expect(visibility?.when.mode).toBe("and");
    expect(visibility?.when.rows[0]).toMatchObject({ left: "form.f2", operator: "eq", value: "sales" });
  });

  it("切到「命中时隐藏」+ 高级模式，保存后 action 与表达式完整", async () => {
    const { wrapper, store } = await mountWithNodes({
      id: "f1",
      component: "input",
      props: { label: "姓名" },
    });

    await openConditionDialog(wrapper);

    // action 单选：切到隐藏
    const hideAction = wrapper.findAll(".cond__mode").find((button) => button.text().includes("命中时隐藏"));
    expect(hideAction).toBeTruthy();
    await hideAction!.trigger("click");

    await wrapper.find(".cond__add").trigger("click");
    await wrapper.find(".cond__add").trigger("click");
    expect(wrapper.findAll(".cond__row")).toHaveLength(3);

    const rows = wrapper.findAll(".cond__row");
    for (const row of rows) {
      await row.find(".cond__only input").setValue(true);
      await row.find(".cond__value--only").setValue("true");
    }

    const advanced = wrapper.findAll(".cond__mode").find((button) => button.text().includes("高级"));
    expect(advanced).toBeTruthy();
    await advanced!.trigger("click");
    await wrapper.find(".cond__expression").setValue("1 and (2 or 3)");
    await wrapper.find(".cond__ok").trigger("click");
    await tick();

    const visibility = store.page.children[0].visibility;
    expect(visibility?.action).toBe("hide");
    expect(visibility?.when.mode).toBe("advanced");
    expect(visibility?.when.expression).toBe("1 and (2 or 3)");
    expect(visibility?.when.rows).toHaveLength(3);
    expect(visibility?.when.rows[0]).toEqual({ value: "true" });
  });

  it("条件摘要在面板上可见，含模式与命中动作", async () => {
    const { wrapper, store } = await mountWithNodes({
      id: "f1",
      component: "input",
      props: { label: "姓名" },
    });
    store.setVisibility({
      when: { mode: "or", rows: [{ left: "form.f2", operator: "eq", value: "x" }] },
      action: "hide",
    });
    await tick();

    const tabs = wrapper.findAll(".inspector__tab");
    const styleTab = tabs.find((tab) => tab.text().includes("样式"));
    await styleTab!.trigger("click");
    await tick();

    const summary = wrapper.findAll(".style__cond-btn:not(.style__calc-btn)")[0].text();
    expect(summary).toContain("1 条 · 或者 · 命中隐藏");
  });
});

describe("条件源清单：子表单单向作用域", () => {
  const page: PageSchema = {
    schemaVersion: "1.1.0",
    id: "p_scope",
    type: "page" as const,
    children: [
      { id: "outside", component: "input", props: { label: "外部字段" } },
      {
        id: "orders",
        component: "ec-subform",
        props: { itemPath: "orders" },
        children: [
          { id: "qty", component: "input", props: { label: "数量" } },
          { id: "name", component: "input", props: { label: "名称" } },
        ],
      },
      {
        id: "goods",
        component: "ec-subform",
        props: { itemPath: "goods" },
        children: [{ id: "price", component: "input", props: { label: "价格" } }],
      },
    ],
  };

  it("子表单内的配置方只能选同一子表单内元素", () => {
    const paths = collectConditionElements(page, { nodeId: "qty" }).map((item) => item.path);
    expect(paths).toContain("form.orders[0].name");
    expect(paths).not.toContain("form.outside");
    expect(paths).not.toContain("form.goods[0].price");
  });

  it("子表单外的配置方可选明细字段，且标记需要聚合", () => {
    const items = collectConditionElements(page, { nodeId: "outside" });
    const detail = items.find((item) => item.path === "form.orders[0].qty");
    expect(detail?.requiresAggregate).toBe(true);
    expect(items.some((item) => item.path === "form.goods[0].price")).toBe(true);
  });
});
