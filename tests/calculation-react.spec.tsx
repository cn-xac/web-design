// @vitest-environment jsdom
/**
 * React 侧数据计算：运行时自动回填 + 设计器计算弹窗（rtHicl）。
 * 与 Vue 侧 calculation-vue.spec.ts 一一对应，保证两端行为不漂移。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { SchemaRenderer, nativeAdapter } from "@x-ac/web-design-react";
import type { SchemaRendererHandle } from "@x-ac/web-design-react";
import { SchemaDesigner } from "@x-ac/web-design-react/designer";
import type { SchemaDesignerHandle } from "@x-ac/web-design-react/designer";
import { SCHEMA_VERSION, createEmptyPage, createMemoryRepository } from "@x-ac/web-design-core";
import type { NodeSchema, PageSchema } from "@x-ac/web-design-core";

beforeEach(() => {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:mock";
    URL.revokeObjectURL = () => undefined;
  }
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
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
  id: "page_calc_react",
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

describe("React 运行时：计算结果自动回填", () => {
  it("挂载即算出结果，setData 改变依赖后自动重算", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ref = createRef<SchemaRendererHandle>();

    await act(async () => {
      root.render(<SchemaRenderer ref={ref} page={runtimePage()} ui={nativeAdapter} />);
    });
    expect((ref.current!.scope as ScopeLike).form.n_total).toBe(12);

    await act(async () => {
      ref.current!.setData({ form: { n_price: 7, n_qty: 2 } });
    });
    expect((ref.current!.scope as ScopeLike).form.n_total).toBe(9);

    await act(async () => root.unmount());
    container.remove();
  });
});

function pageWith(children: NodeSchema[]): PageSchema {
  return { ...createEmptyPage("计算测试"), id: "p1", children };
}

function setup(page: PageSchema) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const repo = createMemoryRepository([page]);
  const ref = createRef<SchemaDesignerHandle>();

  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(<SchemaDesigner pageId="p1" repository={repo} ref={ref} />);
    });
  };
  const cleanup = async (): Promise<void> => {
    await act(async () => root.unmount());
    container.remove();
  };
  const select = async (nodeId: string): Promise<void> => {
    const node = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    if (!node) throw new Error(`画布上找不到节点 ${nodeId}`);
    await act(async () => node.click());
  };
  const nodeOf = (nodeId: string): NodeSchema | undefined =>
    (JSON.parse(ref.current!.exportSchema()) as PageSchema).children.find((node) => node.id === nodeId);
  return { container, render, cleanup, select, nodeOf };
}

const click = async (element: Element | null | undefined): Promise<void> => {
  if (!element) throw new Error("要点击的元素不存在");
  await act(async () => (element as HTMLElement).click());
};

const byText = (container: HTMLElement, selector: string, text: string): HTMLElement | undefined =>
  [...container.querySelectorAll<HTMLElement>(selector)].find((element) =>
    (element.textContent ?? "").includes(text),
  );

async function setNativeValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function openCalculationDialog(container: HTMLElement) {
  await click(byText(container, ".inspector__tab", "样式"));
  await click(container.querySelector(".style__calc-btn"));
}

describe("React 设计器：数据计算弹窗", () => {
  it("属性面板头部有「高级计算」入口，点击直接打开配置弹窗", async () => {
    const ui = setup(
      pageWith([{ id: "f1", component: "text", props: { label: "合计" } }]),
    );
    try {
      await ui.render();
      await ui.select("f1");
      const entry = ui.container.querySelector(".props__calc");
      expect(entry?.textContent).toContain("高级计算");
      await click(entry);
      expect(ui.container.querySelector(".wbd-modal__title")?.textContent).toContain("配置高级计算");
    } finally {
      await ui.cleanup();
    }
  });

  it("选参与元素 + 高级函数算式 → 保存后写入 node.calculation，并自动绑定文字元素", async () => {
    const ui = setup(
      pageWith([
        { id: "f1", component: "text", props: { label: "合计" } },
        { id: "f2", component: "number", props: { label: "数量" } },
      ]),
    );
    try {
      await ui.render();
      await ui.select("f1");
      await openCalculationDialog(ui.container);

      expect(ui.container.querySelector(".wbd-modal__title")?.textContent).toContain("配置高级计算");
      expect(ui.container.querySelectorAll(".calc__fn").length).toBeGreaterThan(10);

      await setNativeValue(ui.container.querySelector(".calc__element") as HTMLSelectElement, "form.f2");
      await setNativeValue(
        ui.container.querySelector(".calc__formula") as HTMLTextAreaElement,
        "ROUND(A * 1.5, 1)",
      );
      await click(ui.container.querySelector(".calc__ok"));

      const node = ui.nodeOf("f1");
      expect(node?.calculation).toMatchObject({
        formula: "ROUND(A * 1.5, 1)",
        operands: [{ alias: "A", path: "form.f2" }],
      });
      expect(node?.props?.text).toBe("{{form.f1}}");
    } finally {
      await ui.cleanup();
    }
  });

  it("悬停函数按钮显示参数、返回值与示例说明", async () => {
    const ui = setup(
      pageWith([
        { id: "f1", component: "text", props: { label: "合计" } },
        { id: "f2", component: "number", props: { label: "数量" } },
      ]),
    );
    try {
      await ui.render();
      await ui.select("f1");
      await openCalculationDialog(ui.container);
      expect(ui.container.querySelector(".calc__fn-help--empty")).toBeTruthy();

      const round = [...ui.container.querySelectorAll<HTMLElement>(".calc__fn")].find(
        (button) => button.textContent?.trim() === "ROUND",
      );
      expect(round).toBeTruthy();
      await act(async () => {
        round!.focus();
        round!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      });
      const help = ui.container.querySelector(".calc__fn-help");
      expect(help?.textContent).toContain("ROUND(A, 2)");
      expect(help?.textContent).toContain("参数");
      expect(help?.textContent).toContain("返回");
      expect(help?.textContent).toContain("示例");
    } finally {
      await ui.cleanup();
    }
  });

  it("点问号打开完整使用说明弹窗，关闭后回到计算弹窗", async () => {
    const ui = setup(
      pageWith([
        { id: "f1", component: "text", props: { label: "合计" } },
        { id: "f2", component: "number", props: { label: "数量" } },
      ]),
    );
    try {
      await ui.render();
      await ui.select("f1");
      await openCalculationDialog(ui.container);

      await click(ui.container.querySelector(".calc__help-btn"));
      // 说明弹窗 createPortal 到 body，用 document 查询
      const help = document.body.querySelector(".calc__help");
      expect(help).toBeTruthy();
      expect(document.body.querySelectorAll(".calc__help-fn")).toHaveLength(18);
      expect(help?.textContent).toContain("一、通用规则");
      expect(help?.textContent).toContain("三、常见业务配方");
      expect(help?.textContent).toContain("四、限制与排错");

      await click(document.body.querySelector(".calc__help-close"));
      expect(document.body.querySelector(".calc__help")).toBeNull();
      expect(ui.container.querySelector(".calc__formula")).toBeTruthy();
    } finally {
      await ui.cleanup();
    }
  });

  it("组件树「特殊设置」列出高级计算节点，并展示元素标签与绑定路径", async () => {
    const ui = setup(
      pageWith([
        {
          id: "f1",
          component: "text",
          props: { label: "合计", text: "{{form.f1}}" },
          calculation: calcConfig,
        },
        // 表单控件没有 Label：元素标签应置空（不渲染 tag）
        { id: "f2", component: "number", calculation: calcConfig },
      ]),
    );
    try {
      await ui.render();
      const tabs = ui.container.querySelectorAll(".opanel__tab");
      expect(tabs).toHaveLength(2);
      await click(tabs[1]);

      const rows = ui.container.querySelectorAll(".oset__row");
      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector(".oset__flag--calc")?.textContent).toBe("算");
      // 元素标签取元素自身的 Label / 内容，而不是物料类型
      expect(rows[0].querySelector(".oset__tag")?.textContent).toBe("合计");
      expect(rows[0].querySelector(".oset__path")?.textContent).toBe("form.f1");
      expect(rows[1].querySelector(".oset__tag")).toBeNull();
      expect(rows[1].querySelector(".oset__path")?.textContent).toBe("form.f2");
    } finally {
      await ui.cleanup();
    }
  });

  it("函数按钮插入签名；移除计算后配置消失", async () => {
    const ui = setup(
      pageWith([
        { id: "f1", component: "text", props: { label: "合计" } },
        { id: "f2", component: "number", props: { label: "数量" } },
      ]),
    );
    try {
      await ui.render();
      await ui.select("f1");
      await openCalculationDialog(ui.container);
      await setNativeValue(ui.container.querySelector(".calc__element") as HTMLSelectElement, "form.f2");

      const sum = [...ui.container.querySelectorAll<HTMLElement>(".calc__fn")].find(
        (button) => button.textContent?.trim() === "SUM",
      );
      expect(sum).toBeTruthy();
      await click(sum);
      await click(ui.container.querySelector(".calc__ok"));
      expect(ui.nodeOf("f1")?.calculation?.formula).toContain("SUM(");

      await openCalculationDialog(ui.container);
      await click(ui.container.querySelector(".calc__clear"));
      expect(ui.nodeOf("f1")?.calculation).toBeUndefined();
    } finally {
      await ui.cleanup();
    }
  });
});
