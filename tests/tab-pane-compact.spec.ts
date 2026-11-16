// @vitest-environment jsdom
/**
 * 页签内容在「保存 → 预览」往返后仍要渲染（rGjzDs 预览空白回归）。
 *
 * 预览链路 = DesignerView.preview() → save()（内部 compactPage）→ 重新 load。
 * compactPage 会删掉与物料默认值相同的 props，必须保证 pane 容器与其 paneId 不被裁掉。
 */
import { describe, expect, it } from "vitest";
import { compactPage, createRegistry, DesignerStore, MATERIALS, type Material, type NodeSchema, type PageSchema } from "@x-ac/web-design-core";

const tabsMaterial: Material = {
  component: "ec-tabs",
  title: "标签页",
  category: "布局",
  kind: "display",
  icon: "▭",
  paneSlotKey: "paneId",
  defaultProps: {
    items: [
      { id: "tab1", label: "基本信息", content: "design" },
      { id: "tab2", label: "扩展配置", content: "design" },
    ],
  },
  fields: [],
};

const registry = createRegistry([...MATERIALS, tabsMaterial]);

function storeWith(page: PageSchema): DesignerStore {
  const store = new DesignerStore();
  store.setMaterialCatalog(registry);
  store.setPage(page);
  return store;
}

describe("compactPage 不能裁掉页签结构", () => {
  it("pane 容器与 paneId 在压缩后保留", () => {
    const store = storeWith({ schemaVersion: "1.3.0", id: "p", type: "page", children: [] });
    store.addNode("ec-tabs", null, "after");
    const page = store.getSnapshot().page;
    const compact = compactPage(page);

    const tabs = compact.children[0];
    expect(tabs.component).toBe("ec-tabs");
    const panes = (tabs.children ?? []).filter((c) => c.props?.paneId);
    expect(panes.length).toBe(2);
    expect(panes.map((p) => p.props?.paneId)).toEqual(["tab1", "tab2"]);
  });

  it("保存后重新加载，pane 容器仍在", () => {
    const store = storeWith({ schemaVersion: "1.3.0", id: "p", type: "page", children: [] });
    store.addNode("ec-tabs", null, "after");
    const compact = compactPage(store.getSnapshot().page);

    const reloaded = storeWith(compact);
    const tabs = reloaded.getSnapshot().page.children[0];
    const panes = (tabs.children ?? []).filter((c) => c.props?.paneId);
    expect(panes.map((p) => p.props?.paneId)).toEqual(["tab1", "tab2"]);
  });

  it("用户拖进 pane 的节点在压缩后保留在对应容器里", () => {
    const store = storeWith({ schemaVersion: "1.3.0", id: "p", type: "page", children: [] });
    store.addNode("ec-tabs", null, "after");
    const tabs = store.getSnapshot().page.children[0];
    const pane = (tabs.children ?? []).find((c) => c.props?.paneId === "tab1")!;

    store.addNode("ec-text", pane.id, "inside");
    const compact = compactPage(store.getSnapshot().page);
    const compactPane = (compact.children[0].children ?? []).find((c) => c.props?.paneId === "tab1")!;
    expect(compactPane.children?.length).toBe(1);
    expect(compactPane.children![0].component).toBe("ec-text");
  });
});
