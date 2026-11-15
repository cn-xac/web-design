/**
 * 数据计算求值（纯函数，core 中无框架 / 无浏览器 API）。
 *
 * 一次重算的链路：
 *   参与条件（复用 ConditionGroup） → 参与元素取值（明细字段按聚合口径）
 *   → 注入别名变量 → 受限表达式 + 白名单高级函数求值
 *   → 结果归一（小数位 / 输出形态）→ 值变化才写回目标绑定路径。
 *
 * 「值变化才写」是响应式安全的必要条件：Vue 的 deep watch 与 React 的 version effect
 * 都会因为写回再次触发，值不变则立刻收敛，不会形成循环。
 */

import {
  evaluateWithFunctions,
  getByPath,
  setByPath,
  validateExpression,
  type Scope,
} from "../schema/expression";
import { aggregateSeries, collectSeries, evaluateConditionGroup } from "../visibility/evaluate";
import type { MaterialRegistry } from "../materials/registry";
import type { PageSchema } from "../schema/types";
import { CALCULATION_FUNCTIONS, CALCULATION_FUNCTION_MAP } from "./functions";
import { collectCalculationTargets } from "./sources";
import type { CalculationConfig, CalculationOperand, CalculationResult } from "./types";

const ROW_PLACEHOLDER = /\[0\]/g;
const AGGREGATES = new Set(["sum", "avg", "min", "max"]);
const CONDITION_MODES = new Set(["and", "or", "advanced"]);

/** 别名不能占用作用域根变量、字面量与函数名，否则会悄悄覆盖 scope */
const RESERVED_ALIASES = new Set([
  "form",
  "data",
  "response",
  "scope",
  "window",
  "globalThis",
  "document",
  "constructor",
  "prototype",
  "true",
  "false",
  "null",
  "undefined",
  ...CALCULATION_FUNCTIONS.map((fn) => fn.name),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withRowIndex(path: string, rowIndex: number): string {
  return path.replace(ROW_PLACEHOLDER, `[${rowIndex}]`);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** 参与元素取值：明细字段可按全部行聚合，或按当前行取值 */
export function resolveCalculationOperand(
  operand: CalculationOperand,
  scope: Scope,
  rowIndex = 0,
): unknown {
  const path = operand.path;
  if (ROW_PLACEHOLDER.test(path)) {
    ROW_PLACEHOLDER.lastIndex = 0;
    if (operand.aggregate) {
      const series = collectSeries(scope, path);
      if (series !== null) return aggregateSeries(series, operand.aggregate);
    }
    return getByPath(scope, withRowIndex(path, rowIndex));
  }
  return getByPath(scope, path);
}

/** 目标路径落在明细里时，需要按当前行数逐行计算写回 */
export function calculationRowIndexes(path: string, scope: Scope): number[] {
  if (!ROW_PLACEHOLDER.test(path)) return [0];
  ROW_PLACEHOLDER.lastIndex = 0;
  const head = path.slice(0, path.search(ROW_PLACEHOLDER)).replace(/\.$/, "");
  const list = head ? getByPath(scope, head) : undefined;
  if (!Array.isArray(list)) return [];
  return list.map((_, index) => index);
}

function normalizeResult(raw: unknown, config: CalculationConfig): unknown {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "number" && !Number.isFinite(raw)) return "";
  if (config.output === "text") return typeof raw === "string" ? raw : String(raw);
  if (typeof raw === "number" && typeof config.precision === "number" && Number.isFinite(config.precision)) {
    const places = Math.min(10, Math.max(0, Math.trunc(config.precision)));
    const factor = 10 ** places;
    return Math.round((raw + Number.EPSILON) * factor) / factor;
  }
  return raw;
}

export interface CalculationOutcome {
  value: unknown;
  /** true = 本次不写回（条件未命中 / 配置缺失 / 算式非法） */
  skipped: boolean;
  reason?: string;
}

/** 单点求值：给定配置与作用域，算出这一行应写入的值 */
export function evaluateCalculation(
  config: CalculationConfig,
  scope: Scope,
  rowIndex = 0,
): CalculationOutcome {
  const formula = (config.formula ?? "").trim();
  const operands = config.operands ?? [];
  if (!formula || operands.length === 0) {
    return { value: undefined, skipped: true, reason: "未配置算式或参与元素" };
  }
  const syntax = validateExpression(formula, CALCULATION_FUNCTION_MAP);
  if (syntax) return { value: undefined, skipped: true, reason: `算式语法错误：${syntax}` };

  if (config.when && config.when.rows.length > 0 && !evaluateConditionGroup(config.when, scope)) {
    return { value: undefined, skipped: true, reason: "参与条件未命中" };
  }

  const variables: Scope = {};
  let hasBlank = false;
  for (const operand of operands) {
    let value = resolveCalculationOperand(operand, scope, rowIndex);
    if (isBlank(value)) {
      hasBlank = true;
      value = config.emptyAsZero ? 0 : "";
    }
    variables[operand.alias] = value;
  }
  // 依赖为空且未开启「空值按 0」时清空结果，避免把上一次的旧值留在页面上
  if (hasBlank && !config.emptyAsZero) {
    return { value: "", skipped: false };
  }

  const raw = evaluateWithFunctions(formula, { ...scope, ...variables }, CALCULATION_FUNCTION_MAP);
  return { value: normalizeResult(raw, config), skipped: false };
}

export interface CalculationRunOptions {
  registry?: MaterialRegistry;
  /** 自定义写入通道；缺省直接写 scope（Vue reactive / React ref 都适用） */
  write?: (path: string, value: unknown) => void;
}

/**
 * 重算整页所有计算节点并写回。返回每个目标的结果，供宿主判断是否要刷新（React）。
 * 写回一律经过「值变化」判断，保证重复调用幂等。
 */
export function applyCalculations(
  page: PageSchema,
  scope: Scope,
  options: CalculationRunOptions = {},
): CalculationResult[] {
  const targets = collectCalculationTargets(page, { registry: options.registry });
  const write = options.write ?? ((path: string, value: unknown) => setByPath(scope, path, value));
  const results: CalculationResult[] = [];

  for (const target of targets) {
    const indexes = calculationRowIndexes(target.path, scope);
    for (const index of indexes) {
      const actualPath = withRowIndex(target.path, index);
      const outcome = evaluateCalculation(target.config, scope, index);
      if (outcome.skipped) {
        results.push({
          nodeId: target.nodeId,
          path: actualPath,
          value: undefined,
          changed: false,
          skipped: true,
          reason: outcome.reason,
        });
        continue;
      }
      const previous = getByPath(scope, actualPath);
      const changed = !Object.is(previous, outcome.value);
      if (changed) write(actualPath, outcome.value);
      results.push({
        nodeId: target.nodeId,
        path: actualPath,
        value: outcome.value,
        changed,
        skipped: false,
      });
    }
  }
  return results;
}

/** 算式静态校验（设计器保存前调用，不执行） */
export function validateCalculationFormula(formula: string): string | null {
  if (!formula.trim()) return "算式不能为空";
  const syntax = validateExpression(formula, CALCULATION_FUNCTION_MAP);
  return syntax ? `算式语法错误：${syntax}` : null;
}

/** 配置静态校验，validator 与设计器共用；返回错误文案数组 */
export function validateCalculationConfig(config: unknown, targetPath?: string): string[] {
  if (!isRecord(config)) return ["calculation 必须是对象"];
  const errors: string[] = [];

  const formulaError = validateCalculationFormula(typeof config.formula === "string" ? config.formula : "");
  if (formulaError) errors.push(formulaError);

  const operands = config.operands;
  if (!Array.isArray(operands) || operands.length === 0) {
    errors.push("至少选择一个参与元素");
  } else {
    const aliases = new Set<string>();
    operands.forEach((raw, index) => {
      const prefix = `参与元素 ${index + 1}`;
      if (!isRecord(raw)) {
        errors.push(`${prefix} 必须是对象`);
        return;
      }
      const alias = typeof raw.alias === "string" ? raw.alias.trim() : "";
      if (!/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(alias)) {
        errors.push(`${prefix} 的别名必须是以字母开头的变量名`);
      } else if (RESERVED_ALIASES.has(alias)) {
        errors.push(`${prefix} 的别名 ${alias} 是保留字`);
      } else if (aliases.has(alias)) {
        errors.push(`${prefix} 的别名 ${alias} 重复`);
      } else {
        aliases.add(alias);
      }
      if (typeof raw.path !== "string" || !raw.path.trim()) {
        errors.push(`${prefix} 缺少绑定路径`);
      } else if (targetPath && raw.path === targetPath) {
        errors.push(`${prefix} 不能引用当前元素自身`);
      }
      if (raw.aggregate !== undefined && !AGGREGATES.has(String(raw.aggregate))) {
        errors.push(`${prefix} 的聚合口径只支持 sum / avg / min / max`);
      }
    });
  }

  if (
    config.precision !== undefined &&
    (typeof config.precision !== "number" ||
      !Number.isFinite(config.precision) ||
      config.precision < 0 ||
      config.precision > 10)
  ) {
    errors.push("小数位必须是 0~10 的数字");
  }
  if (config.output !== undefined && config.output !== "number" && config.output !== "text") {
    errors.push("输出形态只支持 number / text");
  }
  if (config.when !== undefined) {
    if (!isRecord(config.when) || !Array.isArray(config.when.rows) || !CONDITION_MODES.has(String(config.when.mode))) {
      errors.push("参与条件必须是合法的 ConditionGroup");
    }
  }
  return errors;
}
