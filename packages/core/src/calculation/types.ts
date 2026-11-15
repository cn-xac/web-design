/**
 * 数据计算契约（@todo rtHicl「添加 数据计算功能」）。
 *
 * 设计要点：
 * - 配置挂在**目标节点自身**（`NodeSchema.calculation`），结果回填到该节点的绑定路径；
 * - 参与元素是「绑定路径 + 聚合口径」，与 `ConditionRow.left` 同源；
 * - 算式不是可执行代码：只允许受限运算 + 内核静态白名单函数（见 functions.ts）；
 * - 「参与条件」直接复用通用多条件组件 (rfD7Jv) 的 `ConditionGroup`，
 *   不另造条件模型，设计器也可直接复用 `ConditionBuilder`。
 *
 * 高级函数与通用表达式的关系：通用 `{{path}}` 绑定仍禁函数调用；
 * 只有计算模块求值算式时，才把白名单函数表显式注入 `evaluateWithFunctions()`。
 */

import type { ConditionAggregate, ConditionGroup } from "../visibility/types";

export { CONDITION_AGGREGATES as CALCULATION_AGGREGATES } from "../visibility/types";

/** 结果写入形态：number 保留数值；text 一律转字符串 */
export type CalculationOutput = "number" | "text";

/** 参与计算的一个元素（在算式里表现为一个变量） */
export interface CalculationOperand {
  /** 变量名，如 A / B / price；在算式中直接引用 */
  alias: string;
  /** 绑定路径，子表单明细字段带 `[0]` 占位（与 `collectConditionElements` 一致） */
  path: string;
  /** 设计期回显用的元素名，运行时不读 */
  label?: string;
  /** 引用子表单明细字段时的聚合口径；缺省按当前行取值 */
  aggregate?: ConditionAggregate;
}

export interface CalculationConfig {
  /** 参与元素列表，别名不可重复 */
  operands: CalculationOperand[];
  /**
   * 算式，支持受限运算与白名单高级函数，例如：
   * `A * B`、`ROUND(SUM(A, B), 2)`、`IF(A > 0, A * 0.8, 0)`。
   * 字符串里不出现函数实现，函数名只是协议符号。
   */
  formula: string;
  /** 参与条件（复用 rfD7Jv 多条件组件）；未配置或条件组为空表示始终参与 */
  when?: ConditionGroup;
  /** 结果小数位（0~10）；未配置时保留原始计算精度 */
  precision?: number;
  /** 参与元素为空时按 0 参与；缺省则结果为空字符串（清空目标） */
  emptyAsZero?: boolean;
  /** 输出形态，缺省 number */
  output?: CalculationOutput;
}

/** 设计器给参与元素分配的默认别名：A、B、C…… */
export const CALCULATION_ALIASES: readonly string[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** 一个带计算配置的节点（设计期与运行时共用） */
export interface CalculationTarget {
  nodeId: string;
  /** 目标绑定路径，子表单内带 `[0]` 占位 */
  path: string;
  label: string;
  config: CalculationConfig;
  /** 展示类元素的正文属性名；无绑定时设计器据此自动写入 `{{path}}` */
  displayProp?: string;
}

/** 一次写回的结果，供运行时判断是否要强制刷新（React） */
export interface CalculationResult {
  nodeId: string;
  /** 实际写回路径（`[0]` 已替换为真实行号） */
  path: string;
  value: unknown;
  /** 本次是否真的写了（值发生变化） */
  changed: boolean;
  /** 条件未命中 / 配置不全 / 算式非法，未写回 */
  skipped: boolean;
  reason?: string;
}
