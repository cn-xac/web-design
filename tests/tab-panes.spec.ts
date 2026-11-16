import { describe, it, expect } from "vitest";
import {
  DesignerStore,
  createEmptyPage,
  paneContainerOf,
  paneContainersOf,
  syncTabPanes,
  toJSON,
  type NodeSchema,
  type TabItem,
} from "@x-ac/web-design-core";

/**
 * 标签页 pane 容器同步（rGjzDs）。
 * 覆盖：design 页签建容器、删除隔离、重排不串、旧文本迁移、往返一致、单步撤销。
 */

function tabsNode(items: TabItem[], extra?: NodeSchema[]): NodeSchema {
  return { id: "tabs1", component: "ec-tabs", props: { items }, children: extra ?? [] };
}

const item = (id: string, content: TabItem["content"] = "design"): TabItem => ({ id, label: id, content });

describe("syncTabPanes", () => {
  it("为 design 页签建容器，非 design 不建", () => {
    const tabs = tabsNode([item("a"), item("b", "url"), item("c")]);
    expect(syncTabPanes(tabs, tabs.props!.items as TabItem[])).toBe(true);
    const panes = paneContainersOf(tabs);
    expect(panes.map((p) => p.props?.paneId)).toEqual(["a", "c"]);
    expect(panes.every((p) => p.component === "ec-container" && Array.isArray(p.children))).toBe(true);
  });

  it("重排页签时容器按 paneId 复用，子节点不串页签", () => {
    const items = [item("a"), item("b")];
    const tabs = tabsNode(items);
    syncTabPanes(tabs, items);
    paneContainerOf(tabs, "a")!.children = [{ id: "x", component: "ec-text", props: { text: "A 的内容" } }];

    syncTabPanes(tabs, [item("b"), item("a")]);
    expect(tabs.children!.map((n) => n.props?.paneId)).toEqual(["b", "a"]);
    expect(paneContainerOf(tabs, "a")!.children![0].props?.text).toBe("A 的内容");
    expect(paneContainerOf(tabs, "b")!.children).toHaveLength(0);
  });

  it("删除页签时容器子树一并移除", () => {
    const items = [item("a"), item("b")];
    const tabs = tabsNode(items);
    syncTabPanes(tabs, items);
    paneContainerOf(tabs, "b")!.children = [{ id: "keep?", component: "ec-text" }];

    syncTabPanes(tabs, [item("a")]);
    expect(paneContainerOf(tabs, "b")).toBeNull();
    expect(tabs.children).toHaveLength(1);
  });

  it("未知节点原样保留，不被当作脏数据清掉", () => {
    const other: NodeSchema = { id: "other", component: "ec-divider" };
    const tabs = tabsNode([item("a")], [other]);
    syncTabPanes(tabs, tabs.props!.items as TabItem[]);
    expect(tabs.children!.some((n) => n.id === "other")).toBe(true);
  });

  it("序列化往返后 paneId 与子树一致", () => {
    const items = [item("a"), item("b")];
    const tabs = tabsNode(items);
    syncTabPanes(tabs, items);
    paneContainerOf(tabs, "a")!.children = [{ id: "x", component: "ec-text", props: { text: "hello" } }];

    const json = toJSON({ ...createEmptyPage("测试"), children: [tabs] });
    const restored = JSON.parse(json);
    const tabs2 = restored.children[0] as NodeSchema;
    expect(paneContainerOf(tabs2, "a")!.children![0].props?.text).toBe("hello");
  });
});

describe("DesignerStore.setTabItems", () => {
  function makeStore(): DesignerStore {
    const store = new DesignerStore();
    const initial = tabsNode([item("a")]);
    syncTabPanes(initial, [item("a")]); // 模拟设计器里已同步好的初始页面
    store.setPage({ ...createEmptyPage("测试"), children: [initial] });
    return store;
  }

  it("一次写入产生一条撤销记录，撤销后回到原状", () => {
    const store = makeStore();
    store.setTabItems("tabs1", [item("a"), item("b")]);
    const tabs = store.getSnapshot().page.children[0];
    expect(paneContainersOf(tabs).map((p) => p.props?.paneId)).toEqual(["a", "b"]);
    expect(store.getSnapshot().canUndo).toBe(true);

    store.undo();
    const reverted = store.getSnapshot().page.children[0];
    expect(paneContainersOf(reverted).map((p) => p.props?.paneId)).toEqual(["a"]);
  });

  it("新页签默认 design，旧 text 页签正文迁成文本节点", () => {
    const store = makeStore();
    const legacy: TabItem[] = [{ id: "old", label: "旧页签", content: "text", text: "一段文字" }];
    store.setTabItems("tabs1", legacy);
    const pane = paneContainerOf(store.getSnapshot().page.children[0], "old")!;
    expect(pane.children?.[0].component).toBe("ec-text");
    expect(pane.children?.[0].props?.text).toBe("一段文字");
  });
});
