/**
 * 算式构建的纯逻辑（Vue / React 设计器共用）。
 *
 * 设计器只负责渲染按钮与参数槽；光标插入、空格补齐、函数模板拼接都在这里，
 * 保证两端点击出来的算式文本完全一致。不依赖框架，也不依赖浏览器 API。
 */

import type { CalculationFunction } from "./functions";

export interface FormulaInsertion {
  /** 插入后的算式文本 */
  formula: string;
  /** 插入后的光标位置（供 textarea 回焦） */
  cursor: number;
}

/** 需要两侧补空格的 token，避免 A+B 连写难读、也避免 A-1 被误读 */
const SPACED_TOKENS = new Set([
  "+", "-", "*", "/", "%", ">", "<", ">=", "<=", "==", "!=", "&&", "||", "?", ":", ",",
]);

/**
 * 把 token 插到算式指定位置。
 * 运算符自动补空格（已有空格则不重复补），别名 / 数字 / 括号原样插入。
 */
export function insertFormulaToken(
  source: string,
  token: string,
  start: number,
  end = start,
): FormulaInsertion {
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  const before = source.slice(0, from);
  const after = source.slice(to);
  const spaced = SPACED_TOKENS.has(token);
  const left = spaced && before && !/[\s([,]$/.test(before) ? " " : "";
  const right = spaced && !/^[\s),]/.test(after) ? " " : "";
  const fragment = `${left}${token}${right}`;
  return { formula: before + fragment + after, cursor: from + fragment.length };
}

export interface FunctionArgHint {
  label: string;
  /** 参数槽初始值；不填则为空，由用户点选元素或输入 */
  default?: string;
}

/** 函数参数引导表：顺序与签名一致；未登记的函数从签名推导 */
export const FUNCTION_ARG_HINTS: Readonly<Record<string, readonly FunctionArgHint[]>> = {
  SUM: [{ label: "数值 1" }, { label: "数值 2（可继续添加）" }],
  AVG: [{ label: "数值 1" }, { label: "数值 2（可继续添加）" }],
  MIN: [{ label: "数值 1" }, { label: "数值 2（可继续添加）" }],
  MAX: [{ label: "数值 1" }, { label: "数值 2（可继续添加）" }],
  COUNT: [{ label: "值 1" }, { label: "值 2（可继续添加）" }],
  PRODUCT: [{ label: "数值 1" }, { label: "数值 2（可继续添加）" }],
  ROUND: [{ label: "数值" }, { label: "小数位", default: "2" }],
  ROUNDUP: [{ label: "数值" }, { label: "小数位", default: "2" }],
  ROUNDDOWN: [{ label: "数值" }, { label: "小数位", default: "2" }],
  CEIL: [{ label: "数值" }],
  FLOOR: [{ label: "数值" }],
  ABS: [{ label: "数值" }],
  POWER: [{ label: "底数" }, { label: "指数" }],
  SQRT: [{ label: "数值" }],
  MOD: [{ label: "被除数" }, { label: "除数" }],
  IF: [{ label: "条件" }, { label: "条件为真时" }, { label: "条件为假时" }],
  CONCAT: [{ label: "内容 1" }, { label: "内容 2（可继续添加）" }],
  LEN: [{ label: "文本或数组" }],
  COALESCE: [{ label: "候选值 1" }, { label: "候选值 2（可继续添加）" }],
  ISBLANK: [{ label: "值" }],
  IFERROR: [{ label: "值" }, { label: "兜底值", default: "0" }],
  TEXT: [{ label: "数值或日期" }, { label: "格式", default: "0.00" }],
  LEFT: [{ label: "文本" }, { label: "字符数", default: "1" }],
  RIGHT: [{ label: "文本" }, { label: "字符数", default: "1" }],
  MID: [
    { label: "文本" },
    { label: "起始位置（从 1 计）", default: "1" },
    { label: "字符数", default: "1" },
  ],
  TRIM: [{ label: "文本" }],
  UPPER: [{ label: "文本" }],
  LOWER: [{ label: "文本" }],
  TODAY: [],
  NOW: [],
};

/** 取函数的参数槽；未登记提示时从签名里的逗号数推导 */
export function functionArgSlots(fn: CalculationFunction): FunctionArgHint[] {
  const hints = FUNCTION_ARG_HINTS[fn.name.toUpperCase()];
  if (hints) return hints.map((hint) => ({ ...hint }));
  if (fn.maxArgs === 0) return [];
  const open = fn.signature.indexOf("(");
  const close = fn.signature.lastIndexOf(")");
  const inner = open >= 0 && close > open ? fn.signature.slice(open + 1, close) : "";
  if (!inner.trim()) return [];
  return inner.split(",").map((_, index) => ({ label: `参数 ${index + 1}` }));
}

/** 把参数槽拼成调用文本；空槽由 UI 在插入前校验，这里只做拼接 */
export function buildFunctionCall(name: string, args: readonly string[]): string {
  return `${name.toUpperCase()}(${args.map((arg) => arg.trim()).join(", ")})`;
}

/** 常用运算符按钮（value 写入算式，label 为按钮显示） */
export const FORMULA_OPERATOR_BUTTONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "+", label: "+" },
  { value: "-", label: "\u2212" },
  { value: "*", label: "\u00d7" },
  { value: "/", label: "\u00f7" },
  { value: "%", label: "%" },
  { value: "(", label: "(" },
  { value: ")", label: ")" },
  { value: ",", label: "," },
  { value: ">", label: ">" },
  { value: ">=", label: "\u2265" },
  { value: "<", label: "<" },
  { value: "<=", label: "\u2264" },
  { value: "==", label: "=" },
  { value: "&&", label: "\u4e14" },
  { value: "||", label: "\u6216" },
  { value: "?", label: "?" },
  { value: ":", label: ":" },
];

/** 常用数字与小数点按钮 */
export const FORMULA_NUMBER_BUTTONS: ReadonlyArray<string> = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".",
];
