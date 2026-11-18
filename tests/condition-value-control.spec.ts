/**
 * 条件右侧值控件判定（rVDILq）：core 单点逻辑，两端共用。
 * 覆盖「按左元素类型给控件」「选项直接取节点配置」「旧表达式值兼容」。
 */
import { describe, expect, it } from "vitest";
import {
  conditionValueOptions,
  elementValueKind,
  resolveConditionValueControl,
  resolveConditionValueControlByPath,
  type ConditionElement,
} from "@x-ac/web-design-core";
import type { PageSchema } from "@x-ac/web-design-core";

describe("elementValueKind：左元素类型 → 右值形态", () => {
  it("选项类 / 协议前缀归一", () => {
    expect(elementValueKind("select")).toBe("options");
    expect(elementValueKind("ec-radio")).toBe("options");
    expect(elementValueKind("biz-org-tree", true)).toBe("options");
  });

  it("开关 / 数字 / 日期 / 文本各归其位", () => {
    expect(elementValueKind("switch")).toBe("boolean");
    expect(elementValueKind("number")).toBe("number");
    expect(elementValueKind("rate")).toBe("number");
    expect(elementValueKind("slider")).toBe("number");
    expect(elementValueKind("date")).toBe("date");
    expect(elementValueKind("input")).toBe("text");
    expect(elementValueKind("textarea")).toBe("text");
  });
});

describe("resolveConditionValueControl：右值控件描述", () => {
  it("选项类元素给出节点自身配置的候选项，带 label/value", () => {
    const control = resolveConditionValueControl(
      {
        component: "select",
        props: { options: "技术中心 tech\n产品中心 product" },
      },
      "eq",
      "tech",
    );
    expect(control.kind).toBe("options");
    expect(control.options).toEqual([
      { label: "技术中心", value: "tech" },
      { label: "产品中心", value: "product" },
    ]);
  });

  it("开关给真/假，数字给 number 输入，日期按 props.type 选输入形态", () => {
    expect(resolveConditionValueControl({ component: "switch" }, "eq", "true").options).toEqual([
      { label: "真", value: "true" },
      { label: "假", value: "false" },
    ]);
    expect(resolveConditionValueControl({ component: "number" }, "gt", 3).inputType).toBe("number");
    expect(
      resolveConditionValueControl({ component: "date", props: { type: "datetime" } }, "gte", "").inputType,
    ).toBe("datetime-local");
    expect(resolveConditionValueControl({ component: "input" }, "contains", "abc").kind).toBe("text");
  });

  it("一元运算符不渲染右值", () => {
    expect(resolveConditionValueControl({ component: "select" }, "empty", "").kind).toBe("none");
    expect(resolveConditionValueControl({ component: "number" }, "truthy", "").kind).toBe("none");
  });

  it("input 配了候选就升级为可点选", () => {
    const control = resolveConditionValueControl(
      { component: "input", props: { options: "华东,华南" } },
      "eq",
      "华东",
    );
    expect(control.kind).toBe("options");
    expect(conditionValueOptions({ component: "input", props: { options: "华东,华南" } })).toEqual([
      { label: "华东", value: "华东" },
      { label: "华南", value: "华南" },
    ]);
  });

  it("旧表达式值：选项类补保留候选，数字/日期退回 legacy 文本", () => {
    const select = resolveConditionValueControl(
      { component: "select", props: { options: "A a" } },
      "eq",
      "{{form.old}}",
    );
    expect(select.options[0]).toMatchObject({ label: "保留旧值：{{form.old}}", value: "{{form.old}}" });
    expect(resolveConditionValueControl({ component: "number" }, "gt", "{{form.n}}").kind).toBe("legacy");
    expect(resolveConditionValueControl({ component: "date" }, "eq", "{{form.d}}").legacyValue).toBe(
      "{{form.d}}",
    );
  });
});

describe("resolveConditionValueControlByPath：设计器一站式入口", () => {
  const page: PageSchema = {
    schemaVersion: "1.3.0",
    id: "p1",
    type: "page",
    children: [
      { id: "dept", component: "select", props: { options: "技术中心 tech\n产品中心 product" } },
      { id: "age", component: "number", props: {} },
    ],
  };
  const elements: ConditionElement[] = [
    {
      nodeId: "dept",
      path: "form.dept",
      label: "部门",
      title: "下拉选择",
      component: "select",
      isOption: true,
      isGroup: false,
      isFormControl: true,
      subformId: null,
      inSubform: false,
      requiresAggregate: false,
    },
    {
      nodeId: "age",
      path: "form.age",
      label: "年龄",
      title: "数字输入",
      component: "number",
      isOption: false,
      isGroup: false,
      isFormControl: true,
      subformId: null,
      inSubform: false,
      requiresAggregate: false,
    },
  ];

  it("按绑定路径找到节点并取到它的选项", () => {
    const control = resolveConditionValueControlByPath(page, elements, "form.dept", "eq", "product");
    expect(control.kind).toBe("options");
    expect(control.options.map((item) => item.value)).toEqual(["tech", "product"]);
  });

  it("路径找不到元素时按文本兜底，不抛错", () => {
    expect(resolveConditionValueControlByPath(page, elements, "form.missing", "eq", "x").kind).toBe("text");
    expect(resolveConditionValueControlByPath(page, elements, undefined, "eq", "x").kind).toBe("text");
  });
});
