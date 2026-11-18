/**
 * 条件「右侧值」控件判定（设计期用，rVDILq 显示隐藏设置优化）。
 *
 * 下沉到 core 的原因：Vue / React 两端条件弹窗必须给出完全一致的右侧控件，
 * 否则同一条 Schema 在两个设计器里会出现「一边能选、一边只能敲」的偏差。
 * 本模块只做判定与选项解析，不碰 DOM：输入左元素的描述 + 运算符 + 当前值，
 * 输出控件类型与候选项，两端按描述渲染原生控件即可。
 *
 * 口径：
 * - 右侧控件类型由**左元素类型**决定（不是由运算符决定）：
 *   选项类元素 → 下拉选该元素自己配的选项；开关 → 真 / 假；数字/评分/滑块 → 数字输入；
 *   日期 → 日期输入；文本类等 → 文本输入；一元运算符 → 不渲染右侧值。
 * - 值统一以字符串落库：条件求值 `compare()` 用 `text()` 归一，存选项 value 即可命中。
 * - 旧配置里可能有 `{{路径}}` 表达式或不在候选里的值：不静默丢弃。
 *   选项/布尔类给它补一条「保留旧值」候选；数字/日期类退回文本控件并给出提示。
 */

import { bareKey } from "../materials/keys";
import { OPTION_COMPONENTS } from "../data/bindable";
import { parseOptions, type OptionItem } from "../materials/utils";
import { findLocation } from "../schema/tree";
import type { PageSchema } from "../schema/types";
import { CONDITION_OPERATOR_OPTIONS, type ConditionOperator } from "./types";
import type { ConditionElement } from "./sources";

/** 右值控件种类 */
export type ConditionValueControlKind =
  | "none"
  | "options"
  | "boolean"
  | "number"
  | "date"
  | "text"
  | "legacy";

/** 单个候选项：label 展示、value 落库 */
export interface ConditionValueOption {
  label: string;
  value: string;
}

/** 右值控件描述，两端共用 */
export interface ConditionValueControl {
  kind: ConditionValueControlKind;
  /** options / boolean 的候选项；其余类型为空数组 */
  options: ConditionValueOption[];
  /** 输入控件的 type：number / date / datetime-local / month / text */
  inputType?: "number" | "date" | "datetime-local" | "month" | "text";
  /** legacy 类型下要原样保留的旧值 */
  legacyValue?: string;
  /** 给用户看的补充提示 */
  hint?: string;
}

/** 左元素的最小描述，设计器从 `ConditionElement` + 节点 props 拼出即可 */
export interface ConditionValueSource {
  component?: string;
  props?: Record<string, unknown>;
  /** 自定义选项类物料可能没进 OPTION_COMPONENTS，用物料元数据兜底 */
  isOption?: boolean;
}

/** 元素自身的值类型（不含一元 / 兼容态） */
export type ElementValueKind = "options" | "boolean" | "number" | "date" | "text";

const NUMBER_COMPONENTS = new Set(["number", "rate", "slider"]);

/** 只按元素类型判值形态，与运算符无关。裸名比较，兼容 `ec-` 协议前缀。 */
export function elementValueKind(component: string | undefined, isOption?: boolean): ElementValueKind {
  const key = bareKey(component ?? "");
  if (!key) return "text";
  if (isOption || OPTION_COMPONENTS.has(key)) return "options";
  if (key === "switch") return "boolean";
  if (NUMBER_COMPONENTS.has(key)) return "number";
  if (key === "date") return "date";
  return "text";
}

/** 把节点上 `props.options` 归一成候选；input 配了候选也算选项类 */
export function conditionValueOptions(source: ConditionValueSource): ConditionValueOption[] {
  const items: OptionItem[] = parseOptions(source.props?.options);
  return items.map((item) => ({ label: item.label, value: item.value }));
}

/** 元素最终的值类型：配置过 options 的 input 也升级为选项类，与右值控件判定共用 */
export function resolveElementValueKind(source: ConditionValueSource): ElementValueKind {
  return conditionValueOptions(source).length > 0
    ? "options"
    : elementValueKind(source.component, source.isOption);
}

/* --------------------------- 关系运算符候选 --------------------------- */

/** 关系候选项，直接复用 core 的权威常量类型 */
export type ConditionOperatorOption = (typeof CONDITION_OPERATOR_OPTIONS)[number];

/** 各值类型可用的二元关系；unary（为空/不为空）对所有类型开放 */
const OPERATORS_BY_KIND: Record<ElementValueKind, ReadonlySet<ConditionOperator>> = {
  number: new Set(["eq", "ne", "gt", "gte", "lt", "lte"]),
  date: new Set(["eq", "ne", "gt", "gte", "lt", "lte"]),
  boolean: new Set(["eq", "ne", "truthy", "falsy"]),
  options: new Set(["eq", "ne", "contains", "notContains"]),
  text: new Set(["eq", "ne", "contains", "notContains", "startsWith", "endsWith"]),
};
const UNARY_OPERATORS: ReadonlySet<ConditionOperator> = new Set(["empty", "notEmpty"]);

/** 按元素值类型给出关系候选，顺序与 label 均来自 CONDITION_OPERATOR_OPTIONS */
export function conditionOperatorsFor(kind: ElementValueKind): ConditionOperatorOption[] {
  const allowed = OPERATORS_BY_KIND[kind];
  return CONDITION_OPERATOR_OPTIONS.filter(
    (option) => UNARY_OPERATORS.has(option.value) || allowed.has(option.value),
  );
}

/**
 * 设计器一站式入口：按左元素路径取节点类型，给出可用关系。
 * - 左元素为空 / 找不到节点：按文本兜底，仍给一组候选，不让下拉变空；
 * - 旧配置的关系不在候选里：补一条「保留旧关系」置顶，避免打开弹窗就把值改掉。
 */
export function resolveConditionOperatorsByPath(
  page: PageSchema,
  elements: ReadonlyArray<ConditionElement>,
  left: string | undefined,
  current?: ConditionOperator,
): ConditionOperatorOption[] {
  const element = elements.find((item) => item.path === left);
  const source: ConditionValueSource = element
    ? {
        component: element.component,
        isOption: element.isOption,
        props: findLocation(page.children, element.nodeId)?.node?.props,
      }
    : {};
  const list = conditionOperatorsFor(resolveElementValueKind(source));
  if (!current || list.some((option) => option.value === current)) return list;
  const legacy = CONDITION_OPERATOR_OPTIONS.find((option) => option.value === current);
  return legacy ? [{ ...legacy, label: `保留旧关系：${legacy.label}` }, ...list] : list;
}

function isExpressionValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().includes("{{");
}

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function legacyControl(value: unknown, hint: string): ConditionValueControl {
  return {
    kind: "legacy",
    options: [],
    inputType: "text",
    legacyValue: asText(value),
    hint,
  };
}

/**
 * 解析右侧该渲染什么控件。
 *
 * @param source 左元素描述（component / props / isOption）
 * @param operator 该行关系运算符；一元运算符直接返回 none
 * @param value 当前值；仅用于旧配置兼容判断，不影响新配置的控件类型
 */
export function resolveConditionValueControl(
  source: ConditionValueSource,
  operator: ConditionOperator | undefined,
  value: unknown,
): ConditionValueControl {
  if (operator === "empty" || operator === "notEmpty" || operator === "truthy" || operator === "falsy") {
    return { kind: "none", options: [] };
  }

  const rawOptions = conditionValueOptions(source);
  // 与关系候选共用同一类型判定：input 配了候选就按选项类处理
  const kind = resolveElementValueKind(source);
  const textValue = asText(value);
  const hasValue = textValue !== "";
  const inOptions = (values: string[]): boolean => !hasValue || values.includes(textValue);

  switch (kind) {
    case "options": {
      const options: ConditionValueOption[] = rawOptions.slice();
      if (!inOptions(options.map((option) => option.value))) {
        // 旧配置的表达式 / 已删掉的选项：补一条候选，用户不选也能原样保存
        options.unshift({ label: `保留旧值：${textValue}`, value: textValue });
      }
      return { kind: "options", options };
    }
    case "boolean": {
      const options: ConditionValueOption[] = [
        { label: "真", value: "true" },
        { label: "假", value: "false" },
      ];
      if (!inOptions(["true", "false"])) {
        options.unshift({ label: `保留旧值：${textValue}`, value: textValue });
      }
      return { kind: "boolean", options };
    }
    case "number":
      // 数字控件不能回显 {{表达式}}，退回文本并提示；纯字面量照常数字输入
      return isExpressionValue(value)
        ? legacyControl(value, "旧配置为表达式，请改选数字")
        : { kind: "number", options: [], inputType: "number" };
    case "date": {
      const mode = asText(source.props?.type);
      const inputType = mode === "datetime" ? "datetime-local" : mode === "month" ? "month" : "date";
      return isExpressionValue(value)
        ? legacyControl(value, "旧配置为表达式，请改选日期")
        : { kind: "date", options: [], inputType };
    }
    case "text":
    default:
      return { kind: "text", options: [], inputType: "text" };
  }
}

/**
 * 设计器一站式入口：按左元素的绑定路径从页面里找到节点，拼出 source 再判定控件。
 * 左元素为空 / 指向聚合明细（无真实节点）时按文本兜底，不抛错。
 */
export function resolveConditionValueControlByPath(
  page: PageSchema,
  elements: ReadonlyArray<ConditionElement>,
  left: string | undefined,
  operator: ConditionOperator | undefined,
  value: unknown,
): ConditionValueControl {
  const element = elements.find((item) => item.path === left);
  if (!element) return resolveConditionValueControl({}, operator, value);
  const node = findLocation(page.children, element.nodeId)?.node;
  const source: ConditionValueSource = {
    component: element.component,
    isOption: element.isOption,
    props: node?.props,
  };
  return resolveConditionValueControl(source, operator, value);
}
