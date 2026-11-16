// @vitest-environment jsdom
/**
 * 页签内可拖入（rGjzDs 体验修复）。
 *
 * 锁两条必经路径，避免回归：
 * 1. 新建 tabs 时 createNode 按默认 items 预建 pane 容器（否则没有落点）；
 * 2. 渲染器对 paneSlotKey 物料也要渲染 children，否则 pane 容器进不了默认 slot，
 *    页签里永远是空的、拖不进去。
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import type { Component } from "vue";
import { SchemaRenderer } from "@x-ac/web-design-vue";
import { compactPage, createRegistry, DesignerStore, MATERIALS, type Material, type PageSchema, type UiAdapter } from "@x-ac/web-design-core";
const tabsMaterial: Material = {
  component: "ec-tabs",
  title: "标签页",
  category: "布局",
  kind: "display",
  icon: "▭",
  paneSlotKey: "paneId",
  defaultProps: {
    items: [
      { id: "tab_a", label: "A", content: "design" },
      { id: "tab_b", label: "B", content: "design" },
    ],
  },
  fields: [],
};

describe("createNode：新建标签页自带 pane 容器", () => {
  it("按默认 items 为每个 design 页签建容器", () => {
    const store = new DesignerStore();
    store.setMaterialCatalog(createRegistry([...MATERIALS, tabsMaterial]));
    const node = store.createNode("ec-tabs")!;
    expect(node).toBeTruthy();
    const panes = (node.children ?? []).filter((c) => c.props?.paneId);
    expect(panes.map((p) => p.props?.paneId)).toEqual(["tab_a", "tab_b"]);
  });
});

describe("渲染器：paneSlotKey 物料的 children 必须渲染", () => {
  const SlotBox = defineComponent({
    setup: (_p, { slots }) => () => h("div", { class: "slot-box" }, slots.default?.()),
  });
  const adapter: UiAdapter<Component> = {
    name: "test-tabs",
    materials: [...MATERIALS, tabsMaterial],
    components: {
      "ec-tabs": SlotBox,
      "ec-container": SlotBox,
      // text 物料的正文通过 textProp 以默认 slot 传入，桩组件渲染默认 slot 即可
      "ec-text": defineComponent({ setup: (_p, { slots }) => () => h("span", slots.default?.() ?? "") }),
    },
  };

  const page: PageSchema = {
    schemaVersion: "1.3.0",
    id: "p_tabs",
    type: "page",
    state: {},
    children: [
      {
        id: "tabs1",
        component: "ec-tabs",
        props: { items: [{ id: "tab_a", label: "A", content: "design" }] },
        children: [
          {
            id: "pane_a",
            component: "ec-container",
            props: { paneId: "tab_a" },
            children: [{ id: "txt", component: "ec-text", props: { text: "页签里的内容" } }],
          },
        ],
      },
    ],
  };

  it("page 容器里的设计节点出现在 DOM（不再是空页签）", () => {
    const wrapper = mount(SchemaRenderer, { props: { page, adapter } });
    expect(wrapper.html()).toContain("页签里的内容");
  });

  it("压缩（预览/保存）后仍渲染页签内容", () => {
    const compact = compactPage(page);
    // 压缩会删掉与默认值相同的 props；paneId 与 children 必须留存
    const compactTabs = compact.children[0];
    expect((compactTabs.children ?? []).some((c) => c.props?.paneId === "tab_a")).toBe(true);

    const wrapper = mount(SchemaRenderer, { props: { page: compact, adapter } });
    expect(wrapper.html()).toContain("页签里的内容");
  });
});
