import { describe, it, expect } from "vitest";
import {
  derivePageFromJson,
  describeField,
  isDerivedNodeId,
  type JsonPageFieldRule,
} from "@x-ac/web-design-core";
import { createRegistry, MATERIALS } from "@x-ac/web-design-core";

/**
 * 业务 JSON → 页面节点树推导（rGjzDs）。
 * 覆盖：类型映射、绑定路径、确定性 ID、校验规则、fieldMap 覆盖、脏数据降级。
 */

const registry = createRegistry(MATERIALS);
const scope = {
  form: {
    detail: {
      name: "张三",
      age: 18,
      active: true,
      createdAt: "2026-01-02",
      email: "a@b.com",
      tags: ["A", "B"],
      items: [{ sku: "S1", qty: 2 }],
    },
  },
};

describe("derivePageFromJson：类型映射", () => {
  it("string / number / boolean / 日期 分别推导成 input / number / switch / date", () => {
    const nodes = derivePageFromJson(scope.form.detail, { rootPath: "form.detail" });
    const byKey = Object.fromEntries(nodes.map((n) => [String(n.props?.label), n]));
    expect(byKey["name"].component).toBe("ec-input");
    expect(byKey["age"].component).toBe("ec-number");
    expect(byKey["active"].component).toBe("ec-switch");
    expect(byKey["createdAt"].component).toBe("ec-date");
  });

  it("叶子节点绑定 {{rootPath.field}}，读到的值来自 scope", () => {
    const nodes = derivePageFromJson(scope.form.detail, { rootPath: "form.detail" });
    const name = nodes.find((n) => n.props?.label === "name")!;
    expect(name.props?.modelValue).toBe("{{form.detail.name}}");
    const field = describeField(name, scope, registry)!;
    expect(field.path).toBe("form.detail.name");
    expect(field.value).toBe("张三");
  });

  it("嵌套对象推导成容器并递归", () => {
    const nodes = derivePageFromJson({ user: { name: "张三" } }, { rootPath: "form.detail" });
    expect(nodes[0].component).toBe("ec-container");
    expect(nodes[0].children?.[0].props?.modelValue).toBe("{{form.detail.user.name}}");
  });

  it("对象数组推导成子表单，行内字段按字段名自动绑定", () => {
    const nodes = derivePageFromJson(scope.form.detail, { rootPath: "form.detail" });
    const subform = nodes.find((n) => n.component === "ec-subform")!;
    expect(subform.props?.itemPath).toBe("detail.items");
    const sku = subform.children!.find((c) => c.id === "sku")!;
    // 行内字段不写显式 modelValue，靠子表单 BINDING_BASE 自动绑定
    expect(sku.props?.modelValue).toBeUndefined();
  });

  it("只读模式用展示控件", () => {
    const nodes = derivePageFromJson(scope.form.detail, { rootPath: "form.detail", mode: "view" });
    const byKey = Object.fromEntries(nodes.map((n) => [String(n.props?.label), n]));
    expect(byKey["name"].component).toBe("ec-text");
    expect(byKey["active"].component).toBe("ec-tag");
  });
});

describe("derivePageFromJson：ID 与校验", () => {
  it("同一路径推导出的 ID 稳定（避免重渲染失焦）", () => {
    const a = derivePageFromJson(scope.form.detail, { rootPath: "form.detail" });
    const b = derivePageFromJson(scope.form.detail, { rootPath: "form.detail" });
    expect(a.map((n) => n.id)).toEqual(b.map((n) => n.id));
    a.forEach((n) => expect(isDerivedNodeId(n.id)).toBe(true));
  });

  it("email / phone 字段名自动推断格式规则", () => {
    const nodes = derivePageFromJson({ email: "a@b.com", phone: "13800138000" }, { rootPath: "form.x" });
    expect(nodes[0].rules?.[0].type).toBe("email");
    expect(nodes[1].rules?.[0].type).toBe("phone");
  });

  it("fieldMap 可覆盖控件、标题、顺序、规则", () => {
    const fieldMap: Record<string, JsonPageFieldRule> = {
      age: { component: "slider", label: "年龄", order: -1, rules: [{ type: "min", value: 1 }] },
      active: { hidden: true },
    };
    const nodes = derivePageFromJson(scope.form.detail, { rootPath: "form.detail", fieldMap });
    expect(nodes[0].props?.label).toBe("年龄");
    expect(nodes[0].component).toBe("ec-slider");
    expect(nodes[0].rules?.some((r) => r.type === "min")).toBe(true);
    expect(nodes.some((n) => n.props?.label === "active")).toBe(false);
  });
});

describe("derivePageFromJson：降级", () => {
  it("空根路径 / 空值 / 非对象返回空数组", () => {
    expect(derivePageFromJson(scope.form.detail, { rootPath: "" })).toEqual([]);
    expect(derivePageFromJson(null, { rootPath: "form.detail" })).toEqual([]);
    expect(derivePageFromJson("plain", { rootPath: "form.detail" })).toEqual([]);
    expect(derivePageFromJson(42, { rootPath: "form.detail" })).toEqual([]);
  });

  it("超深嵌套被 maxDepth 截断，不无限递归", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    const nodes = derivePageFromJson(deep, { rootPath: "form.deep", maxDepth: 2 });
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("exclude 可排除字段", () => {
    const nodes = derivePageFromJson(scope.form.detail, { rootPath: "form.detail", exclude: ["age", "tags"] });
    expect(nodes.some((n) => n.props?.label === "age")).toBe(false);
    expect(nodes.some((n) => n.props?.label === "tags")).toBe(false);
  });
});
