import { describe, it, expect } from "vitest";
import { createTabId, parseTabItems } from "@x-ac/web-design-core";

/**
 * 标签项归一化（re0BNA）。
 *
 * 标签页 items 从「标题:内容」字符串升级为结构化数组后，
 * 旧页面必须继续能渲染，新页面要能承载 mark / dataPath / url 等内容来源。
 * 这两条都由 parseTabItems 一处收口，运行时与设计器不再各判一遍。
 */

describe("parseTabItems：兼容旧成对字符串", () => {
  it("标题:内容 → label + text", () => {
    expect(parseTabItems("基本信息:第一页内容,扩展配置:第二页内容")).toEqual([
      { id: "tab0", label: "基本信息", text: "第一页内容" },
      { id: "tab1", label: "扩展配置", text: "第二页内容" },
    ]);
  });

  it("只有标题时 text 为空串", () => {
    expect(parseTabItems("基本配置")).toEqual([{ id: "tab0", label: "基本配置", text: "" }]);
  });

  it("空值返回空数组", () => {
    expect(parseTabItems("")).toEqual([]);
    expect(parseTabItems(undefined)).toEqual([]);
    expect(parseTabItems(null)).toEqual([]);
  });
});

describe("parseTabItems：结构化数组", () => {
  it("保留 id / mark / 内容来源", () => {
    expect(
      parseTabItems([
        { id: "a", label: "概览", mark: "overview" },
        { id: "b", label: "详情", dataPath: "form.detailSchema" },
        { id: "c", label: "外部", url: "/api/page/1", method: "post" },
      ]),
    ).toEqual([
      { id: "a", label: "概览", mark: "overview" },
      { id: "b", label: "详情", dataPath: "form.detailSchema" },
      { id: "c", label: "外部", url: "/api/page/1", method: "post" },
    ]);
  });

  it("缺 id 时按下标兜底", () => {
    expect(parseTabItems([{ label: "A" }, { label: "B" }])).toEqual([
      { id: "tab0", label: "A" },
      { id: "tab1", label: "B" },
    ]);
  });

  it("title / value 兼容为 label / text", () => {
    expect(parseTabItems([{ title: "标题", value: "内容" }])).toEqual([
      { id: "tab0", label: "标题", text: "内容" },
    ]);
  });

  it("空 mark 不写入，避免拖出空标记", () => {
    expect(parseTabItems([{ id: "a", label: "A", mark: "" }])).toEqual([{ id: "a", label: "A" }]);
  });

  it("空标题的项被丢弃", () => {
    expect(parseTabItems([{ id: "a", label: "" }, { id: "b", label: "B" }])).toEqual([
      { id: "b", label: "B" },
    ]);
  });

  it("非法 method 被忽略", () => {
    expect(parseTabItems([{ label: "A", url: "/x", method: "delete" }])).toEqual([
      { id: "tab0", label: "A", url: "/x" },
    ]);
  });
});

describe("createTabId", () => {
  it("生成带前缀且互不相同的 id", () => {
    const a = createTabId();
    const b = createTabId();
    expect(a.startsWith("tab_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("支持自定义前缀", () => {
    expect(createTabId("pane").startsWith("pane_")).toBe(true);
  });
});
