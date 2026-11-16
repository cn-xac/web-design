/**
 * 元素显示 / 隐藏配置契约（@todo r5u4Ul「元素的显示和隐藏逻辑优化」）。
 *
 * 设计要点：
 * - 配置挂在**目标节点自身**（`NodeSchema.visibility`），只控制该节点；
 * - 条件行复用通用「多条件组件」(rfD7Jv) 的数据模型，后续外部数据源触发条件、
 *   数据计算 (rtHicl) 的条件参与可直接复用 `ConditionGroup`；
 * - 全部是纯数据，JSON 里不出现可执行代码。
 *
 * 与旧 `directives` 的关系：两者并存；新配置优先级更高，未配置时回落到 directives。
 *
 * 1.3.0 起 visibility 收敛为单一 `when` 条件组 + `action` 方向，旧的 show/hide
 * 双组已移除；本项目无存量数据，升版本不写兼容迁移。
 */

/** 引用子表单明细字段时的聚合口径；缺省为求和 */
export type ConditionAggregate = "sum" | "avg" | "min" | "max" | "text";

/** 条件行关系运算符 */
export type ConditionOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "empty"
  | "notEmpty"
  | "truthy"
  | "falsy";

/** 条件间组合方式；advanced 用序号表达式，如 `1 and (2 or 3)` */
export type ConditionMode = "and" | "or" | "advanced";

export interface ConditionRow {
  /**
   * 左侧元素的绑定路径，例如 `form.type`、`form.orders[0].qty`。
   * 子表单内字段在设计期用 `[0]` 占位（与 `data/bindable.ts` 的 GROUP_INDEX 一致）。
   * 省略时表示「仅值形态」：无左侧、无关系，直接把 value 当布尔表达式求值。
   */
  left?: string;
  /**
   * 左侧取值口径。仅在 left 指向子表单明细字段时有意义：
   * 配置后按**全部行**聚合，否则按当前行取值。缺省 `sum`。
   */
  aggregate?: ConditionAggregate;
  /** 关系运算符；仅值形态时省略 */
  operator?: ConditionOperator;
  /** 右侧值，支持字面量与 `{{path}}` / 裸表达式 */
  value?: unknown;
}

export interface ConditionGroup {
  mode: ConditionMode;
  rows: ConditionRow[];
  /** mode === "advanced" 时的组合表达式，序号从 1 开始 */
  expression?: string;
}

/** 命中判定条件后执行的显隐动作 */
export type VisibilityAction = "show" | "hide";

/**
 * 节点自身的显隐控制配置（1.3.0 起为单一条件组 + 动作）。
 *
 * 语义：`when` 命中时执行 `action`，未命中时执行相反动作——完整布尔闭环，
 * 不存在「条件都没命中」的中间态。这样可彻底消除旧 show/hide 双组设计里
 * 「只配 show 却期望不命中即隐藏」的歧义。
 *
 * - `action` 缺省 `show`：命中即显示，不命中即隐藏（最常用）；
 * - `action: "hide"`：命中即隐藏，不命中即显示；
 * - 隐藏统一用 display:none（mode: "show"），不渲染请继续用旧 directives.if。
 */
export interface VisibilityConfig {
  /** 唯一的判定条件组 */
  when: ConditionGroup;
  /** 命中 when 时执行的行为，缺省 show */
  action?: VisibilityAction;
}

/** 对外暴露的 action 可选项，供设计器单选控件复用 */
export const VISIBILITY_ACTIONS: ReadonlyArray<{ value: VisibilityAction; label: string; hint: string }> = [
  { value: "show", label: "命中时显示", hint: "条件成立时显示，否则隐藏" },
  { value: "hide", label: "命中时隐藏", hint: "条件成立时隐藏，否则显示" },
];

/** 宿主按节点 id 传入的显隐控制 */
export interface ExternalVisibilityEntry {
  visible: boolean;
  /** true = 忽略节点自身条件，强制使用外部结果 */
  force?: boolean;
}

export type ExternalVisibility = Record<string, ExternalVisibilityEntry>;

export type VisibilitySource =
  | "external-force"
  | "local-show"
  | "local-hide"
  | "external"
  | "directive"
  | "default";

export interface VisibilityDecision {
  visible: boolean;
  source: VisibilitySource;
  /** 隐藏方式：display:none（show）或不渲染（if）；visible 为 true 时省略 */
  mode?: "show" | "if";
}

/** 条件求值上下文，由渲染器在子表单内构造 */
export interface VisibilityContext {
  /** 当前明细行下标，用于把 `[0]` 占位替换成真实行；undefined 表示页面级 */
  rowIndex?: number;
}

export const CONDITION_AGGREGATES: ReadonlyArray<{ value: ConditionAggregate; label: string }> = [
  { value: "sum", label: "求和" },
  { value: "avg", label: "平均值" },
  { value: "min", label: "最小值" },
  { value: "max", label: "最大值" },
  { value: "text", label: "文本" },
];

export const CONDITION_OPERATOR_OPTIONS: ReadonlyArray<{
  value: ConditionOperator;
  label: string;
  /** 是否不需要右侧值 */
  unary?: boolean;
  /** 适用值类型：number / string / any */
  kind: "number" | "string" | "any";
}> = [
  { value: "eq", label: "等于", kind: "any" },
  { value: "ne", label: "不等于", kind: "any" },
  { value: "gt", label: "大于", kind: "number" },
  { value: "gte", label: "大于等于", kind: "number" },
  { value: "lt", label: "小于", kind: "number" },
  { value: "lte", label: "小于等于", kind: "number" },
  { value: "contains", label: "包含", kind: "string" },
  { value: "notContains", label: "不包含", kind: "string" },
  { value: "startsWith", label: "开头是", kind: "string" },
  { value: "endsWith", label: "结尾是", kind: "string" },
  { value: "empty", label: "为空", kind: "any", unary: true },
  { value: "notEmpty", label: "不为空", kind: "any", unary: true },
  { value: "truthy", label: "为真", kind: "any", unary: true },
  { value: "falsy", label: "为假", kind: "any", unary: true },
];

export const CONDITION_MODE_OPTIONS: ReadonlyArray<{ value: ConditionMode; label: string }> = [
  { value: "and", label: "并且" },
  { value: "or", label: "或者" },
  { value: "advanced", label: "高级" },
];
