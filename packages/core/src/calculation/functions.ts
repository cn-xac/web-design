/**
 * 数据计算的「高级函数」白名单。
 *
 * 安全约束：
 * - 全部是纯数值 / 字符串 / 布尔运算，不接收 scope、不访问任何全局对象；
 * - 只以「已求值的参数数组」形式被调用，Schema 里只存函数名字符串；
 * - 名字必须命中本表才会被解析器接受，其余函数调用在解析期直接报错。
 */

import type { ExpressionFunctionMap } from "../schema/expression";

export type CalculationFunctionGroup = "聚合" | "数学" | "逻辑与文本" | "日期";

export interface CalculationFunction {
  name: string;
  label: string;
  group: CalculationFunctionGroup;
  /** 设计器插入算式时的模板 */
  signature: string;
  description: string;
  /** 参数个数与类型（设计器「函数说明」展示） */
  params: string;
  /** 返回值与空值行为 */
  returns: string;
  /** 可直接粘贴的示例，含期望结果 */
  example: string;
  minArgs: number;
  /** -1 表示参数个数不设上限 */
  maxArgs: number;
  run: (args: unknown[]) => unknown;
}

function flatten(args: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) out.push(...flatten(arg));
    else out.push(arg);
  }
  return out;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function numbers(args: unknown[]): number[] {
  return flatten(args)
    .map(toNumber)
    .filter((num): num is number => num !== null);
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function roundTo(value: unknown, digits: unknown): number | undefined {
  const num = toNumber(value);
  if (num === null) return undefined;
  const raw = toNumber(digits) ?? 0;
  const places = Math.min(10, Math.max(0, Math.trunc(raw)));
  const factor = 10 ** places;
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

/** Excel 风格定向舍入：up=true 远离零（ROUNDUP），否则向零（ROUNDDOWN） */
function roundDirection(value: unknown, digits: unknown, up: boolean): number | undefined {
  const num = toNumber(value);
  if (num === null) return undefined;
  const places = Math.min(10, Math.max(0, Math.trunc(toNumber(digits) ?? 0)));
  const factor = 10 ** places;
  const scaled = num * factor;
  const nearest = Math.round(scaled);
  // 浮点误差补偿：本就落在整数位上就不要多进一位（如 1.2 * 10 = 12.000000000000002）
  if (Math.abs(scaled - nearest) < 1e-10) return nearest / factor;
  const towardZero = num >= 0 ? Math.floor(scaled) : Math.ceil(scaled);
  const awayFromZero = num >= 0 ? Math.ceil(scaled) : Math.floor(scaled);
  return (up ? awayFromZero : towardZero) / factor;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

interface DateParts {
  y: number;
  M: number;
  d: number;
  h: number;
  m: number;
}

/** 优先按 ISO 字符串取值，避免 new Date("YYYY-MM-DD") 在不同时区差一天 */
function dateParts(value: unknown): DateParts | null {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
    if (match) {
      return {
        y: Number(match[1]),
        M: Number(match[2]),
        d: Number(match[3]),
        h: Number(match[4] ?? 0),
        m: Number(match[5] ?? 0),
      };
    }
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return {
    y: date.getFullYear(),
    M: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    m: date.getMinutes(),
  };
}

function formatDate(parts: DateParts, format: string): string {
  return format
    .replace(/yyyy/gi, String(parts.y))
    .replace(/yy/gi, pad2(parts.y % 100))
    .replace(/MM/g, pad2(parts.M))
    .replace(/M/g, String(parts.M))
    // 中文格式里的 m月 按月份处理；其余小写 m 留给下面的 mm 当分钟
    .replace(/m(?=月)/g, String(parts.M))
    .replace(/dd/gi, pad2(parts.d))
    .replace(/d/gi, String(parts.d))
    .replace(/HH/g, pad2(parts.h))
    .replace(/hh/g, pad2(parts.h % 12 || 12))
    .replace(/mm/g, pad2(parts.m));
}

/** TEXT 的常用格式：日期 y/M/d、数值 0/0.00/#,##0/百分比；未识别的格式原样转字符串 */
function formatText(value: unknown, fmt: unknown): string {
  const format = fmt === null || fmt === undefined ? "" : String(fmt);
  if (!format) return text(value);

  if (/(yyyy|yy|MM|dd)/i.test(format)) {
    const parts = dateParts(value);
    return parts ? formatDate(parts, format) : text(value);
  }

  const num = toNumber(value);
  if (num === null) return text(value);
  const percent = format.includes("%");
  const grouping = format.includes(",");
  const decimals = Math.min(10, (format.split(".")[1] ?? "").replace(/[^0#]/g, "").length);
  const scaled = percent ? num * 100 : num;
  let output = scaled.toFixed(decimals);
  if (grouping) {
    const [integer, fraction] = output.split(".");
    output = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
  }
  return percent ? `${output}%` : output;
}

function localDateString(withTime: boolean): string {
  const now = new Date();
  const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return withTime ? `${day} ${pad2(now.getHours())}:${pad2(now.getMinutes())}` : day;
}

export const CALCULATION_FUNCTIONS: readonly CalculationFunction[] = [
  {
    name: "SUM",
    label: "求和",
    group: "聚合",
    signature: "SUM(A, B)",
    description: "所有参数求和，数组会展开；无有效数值时返回 0",
    params: "1~N 个数值或数值数组；空值、非数值、布尔值会被忽略",
    returns: "所有有效数值之和；无有效数值返回 0",
    example: "SUM(A, B)　A=2、B=3 → 5",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => numbers(args).reduce((a, b) => a + b, 0),
  },
  {
    name: "AVG",
    label: "平均值",
    group: "聚合",
    signature: "AVG(A, B)",
    description: "所有有效数值的算术平均值；无有效数值时返回 0",
    params: "1~N 个数值或数值数组；非数值会被忽略",
    returns: "有效数值个数作分母的算术平均值；无有效数值返回 0",
    example: "AVG(A, B)　A=2、B=4 → 3",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => {
      const list = numbers(args);
      return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    },
  },
  {
    name: "MIN",
    label: "最小值",
    group: "聚合",
    signature: "MIN(A, B)",
    description: "所有有效数值中的最小值",
    params: "1~N 个数值或数值数组",
    returns: "最小值；无有效数值返回 0",
    example: "MIN(A, B, 1)　A=3、B=2 → 1",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => {
      const list = numbers(args);
      return list.length ? Math.min(...list) : 0;
    },
  },
  {
    name: "MAX",
    label: "最大值",
    group: "聚合",
    signature: "MAX(A, B)",
    description: "所有有效数值中的最大值",
    params: "1~N 个数值或数值数组",
    returns: "最大值；无有效数值返回 0",
    example: "MAX(A, B, 1)　A=3、B=2 → 3",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => {
      const list = numbers(args);
      return list.length ? Math.max(...list) : 0;
    },
  },
  {
    name: "COUNT",
    label: "计数",
    group: "聚合",
    signature: "COUNT(A, B)",
    description: "统计非空参数个数，数组按元素展开",
    params: "1~N 个任意值；数组按元素展开",
    returns: "非空值个数（null / undefined / 空串 / 空数组不算）",
    example: "COUNT(A, B)　A=0、B='' → 1",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => flatten(args).filter((value) => !isBlank(value)).length,
  },
  {
    name: "PRODUCT",
    label: "连乘",
    group: "聚合",
    signature: "PRODUCT(A, B)",
    description: "所有有效数值相乘；无有效数值时返回 0",
    params: "1~N 个数值或数值数组",
    returns: "所有有效数值之积；无有效数值返回 0",
    example: "PRODUCT(A, 3)　A=2 → 6",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => {
      const list = numbers(args);
      return list.length ? list.reduce((a, b) => a * b, 1) : 0;
    },
  },
  {
    name: "ROUND",
    label: "四舍五入",
    group: "数学",
    signature: "ROUND(A, 2)",
    description: "按指定小数位四舍五入（缺省 0 位，最多 10 位）",
    params: "x：数值；digits：小数位（可省略，缺省 0，范围 0~10，超界自动收敛）",
    returns: "四舍五入后的数值；x 非数值时返回空值",
    example: "ROUND(A, 2)　A=1.235 → 1.24",
    minArgs: 1,
    maxArgs: 2,
    run: (args) => roundTo(args[0], args[1]),
  },
  {
    name: "ROUNDUP",
    label: "向上舍入",
    group: "数学",
    signature: "ROUNDUP(A, 2)",
    description: "按小数位远离零方向舍入（Excel ROUNDUP 口径）",
    params: "x：数值；digits：小数位（可省略，缺省 0，范围 0~10）",
    returns: "舍入后的数值；x 非数值时返回空值",
    example: "ROUNDUP(1.21, 1) → 1.3；ROUNDUP(-1.21, 1) → -1.3",
    minArgs: 1,
    maxArgs: 2,
    run: (args) => roundDirection(args[0], args[1], true),
  },
  {
    name: "ROUNDDOWN",
    label: "向下舍入",
    group: "数学",
    signature: "ROUNDDOWN(A, 2)",
    description: "按小数位向零方向舍入（Excel ROUNDDOWN 口径）",
    params: "x：数值；digits：小数位（可省略，缺省 0，范围 0~10）",
    returns: "舍入后的数值；x 非数值时返回空值",
    example: "ROUNDDOWN(1.29, 1) → 1.2；ROUNDDOWN(-1.29, 1) → -1.2",
    minArgs: 1,
    maxArgs: 2,
    run: (args) => roundDirection(args[0], args[1], false),
  },
  {
    name: "CEIL",
    label: "向上取整",
    group: "数学",
    signature: "CEIL(A)",
    description: "返回不小于该数值的最小整数",
    params: "x：数值",
    returns: "向上取整结果；x 非数值时返回空值",
    example: "CEIL(A)　A=1.2 → 2",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => {
      const num = toNumber(args[0]);
      return num === null ? undefined : Math.ceil(num);
    },
  },
  {
    name: "FLOOR",
    label: "向下取整",
    group: "数学",
    signature: "FLOOR(A)",
    description: "返回不大于该数值的最大整数",
    params: "x：数值",
    returns: "向下取整结果；x 非数值时返回空值",
    example: "FLOOR(A)　A=1.8 → 1",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => {
      const num = toNumber(args[0]);
      return num === null ? undefined : Math.floor(num);
    },
  },
  {
    name: "ABS",
    label: "绝对值",
    group: "数学",
    signature: "ABS(A)",
    description: "返回数值的绝对值",
    params: "x：数值",
    returns: "绝对值；x 非数值时返回空值",
    example: "ABS(A)　A=-3 → 3",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => {
      const num = toNumber(args[0]);
      return num === null ? undefined : Math.abs(num);
    },
  },
  {
    name: "POWER",
    label: "幂",
    group: "数学",
    signature: "POWER(A, 2)",
    description: "返回底数的指定次幂",
    params: "base：底数；exponent：指数（都必须能转为有限数值）",
    returns: "base 的 exponent 次幂；参数非数值时返回空值",
    example: "POWER(A, 2)　A=3 → 9",
    minArgs: 2,
    maxArgs: 2,
    run: (args) => {
      const base = toNumber(args[0]);
      const exponent = toNumber(args[1]);
      return base === null || exponent === null ? undefined : base ** exponent;
    },
  },
  {
    name: "SQRT",
    label: "平方根",
    group: "数学",
    signature: "SQRT(A)",
    description: "返回平方根；负数返回空值",
    params: "x：非负数值",
    returns: "平方根；负数或非数值时返回空值",
    example: "SQRT(A)　A=9 → 3",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => {
      const num = toNumber(args[0]);
      return num === null || num < 0 ? undefined : Math.sqrt(num);
    },
  },
  {
    name: "MOD",
    label: "取余",
    group: "数学",
    signature: "MOD(A, B)",
    description: "返回两数相除的余数；除数为 0 返回空值",
    params: "a：被除数；b：除数，不能为 0",
    returns: "a % b；除数为 0 或参数非数值时返回空值",
    example: "MOD(A, 4)　A=7 → 3",
    minArgs: 2,
    maxArgs: 2,
    run: (args) => {
      const left = toNumber(args[0]);
      const right = toNumber(args[1]);
      return left === null || right === null || right === 0 ? undefined : left % right;
    },
  },
  {
    name: "IF",
    label: "条件取值",
    group: "逻辑与文本",
    signature: "IF(A > 0, A, 0)",
    description: "条件为真取第二个参数，否则取第三个参数",
    params: "cond：条件；yes：真值分支；no：假值分支（三个参数都会先求值，但均无副作用）",
    returns: "cond 为真取 yes，否则取 no",
    example: "IF(A > 0, A * 0.8, 0)　A=100 → 80",
    minArgs: 3,
    maxArgs: 3,
    run: (args) => (Boolean(args[0]) ? args[1] : args[2]),
  },
  {
    name: "CONCAT",
    label: "拼接",
    group: "逻辑与文本",
    signature: "CONCAT(A, B)",
    description: "把参数按顺序拼成字符串，空值按空串处理",
    params: "1~N 个任意值；数组按元素展开",
    returns: "按顺序拼接的字符串（空值转空串）",
    example: "CONCAT('合计:', A, '元')　A=12 → 合计:12元",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => flatten(args).map(text).join(""),
  },
  {
    name: "LEN",
    label: "长度",
    group: "逻辑与文本",
    signature: "LEN(A)",
    description: "返回字符串或数组的长度",
    params: "x：字符串或数组",
    returns: "长度；空值返回 0，其它类型转字符串后取长度",
    example: "LEN(A)　A='abcd' → 4",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => {
      const value = args[0];
      if (Array.isArray(value) || typeof value === "string") return value.length;
      return isBlank(value) ? 0 : text(value).length;
    },
  },
  {
    name: "COALESCE",
    label: "取首个非空",
    group: "逻辑与文本",
    signature: "COALESCE(A, 0)",
    description: "返回第一个非空参数；全为空时返回空串",
    params: "1~N 个任意值；数组按元素展开",
    returns: "第一个非空值（null / undefined / 空串 / 空数组算空）；全空返回空串",
    example: "COALESCE(A, 0)　A='' → 0",
    minArgs: 1,
    maxArgs: -1,
    run: (args) => {
      const found = flatten(args).find((value) => !isBlank(value));
      return found === undefined ? "" : found;
    },
  },
  {
    name: "ISBLANK",
    label: "是否为空",
    group: "逻辑与文本",
    signature: "ISBLANK(A)",
    description: "空值（null / undefined / 空串 / 空数组）返回 true",
    params: "x：任意值",
    returns: "x 为空返回 true，否则 false",
    example: "ISBLANK(A)　A='' → true",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => isBlank(args[0]),
  },
  {
    name: "IFERROR",
    label: "错误兜底",
    group: "逻辑与文本",
    signature: "IFERROR(A, 0)",
    description: "第一个值为空或非有限数值时取兜底值，否则原样返回",
    params: "value：任意值；fallback：兜底值",
    returns: "value 为 undefined / null / 非有限数值时返回 fallback，其它情况返回 value",
    example: "IFERROR(A / 0, 0)　A=1 → 0",
    minArgs: 2,
    maxArgs: 2,
    run: (args) => {
      const value = args[0];
      return value === undefined ||
        value === null ||
        (typeof value === "number" && !Number.isFinite(value))
        ? args[1]
        : value;
    },
  },
  {
    name: "TEXT",
    label: "格式文本",
    group: "逻辑与文本",
    signature: "TEXT(A, '0.00')",
    description: "按常用格式把数值或日期转成文本",
    params: "value：数值 / 日期；format：'0.00'、'#,##0.00'、'0%'、'yyyy-mm-dd' 等",
    returns: "格式化后的字符串；格式未识别时按普通文本转换",
    example: "TEXT(12.5, '0.00') → '12.50'；TEXT('2026-11-16', 'yyyy年m月d日') → '2026年11月16日'",
    minArgs: 2,
    maxArgs: 2,
    run: (args) => formatText(args[0], args[1]),
  },
  {
    name: "LEFT",
    label: "左侧截取",
    group: "逻辑与文本",
    signature: "LEFT(A, 2)",
    description: "从文本左侧取指定个数的字符",
    params: "text：任意值（转字符串）；count：字符数，可省略（缺省 1）",
    returns: "截取的字符串",
    example: "LEFT('abcdef', 2) → 'ab'",
    minArgs: 1,
    maxArgs: 2,
    run: (args) => text(args[0]).slice(0, Math.max(0, toNumber(args[1]) ?? 1)),
  },
  {
    name: "RIGHT",
    label: "右侧截取",
    group: "逻辑与文本",
    signature: "RIGHT(A, 2)",
    description: "从文本右侧取指定个数的字符",
    params: "text：任意值（转字符串）；count：字符数，可省略（缺省 1）",
    returns: "截取的字符串",
    example: "RIGHT('abcdef', 2) → 'ef'",
    minArgs: 1,
    maxArgs: 2,
    run: (args) => {
      const count = Math.max(0, toNumber(args[1]) ?? 1);
      const source = text(args[0]);
      return count === 0 ? "" : source.slice(-count);
    },
  },
  {
    name: "MID",
    label: "中间截取",
    group: "逻辑与文本",
    signature: "MID(A, 2, 3)",
    description: "从指定位置起取指定个数的字符（Excel 口径，起始位置从 1 计）",
    params: "text：任意值；start：起始位置（从 1 计）；count：字符数",
    returns: "截取的字符串；位置或个数非法时返回空串",
    example: "MID('abcdef', 2, 3) → 'bcd'",
    minArgs: 3,
    maxArgs: 3,
    run: (args) => {
      const start = toNumber(args[1]);
      const count = toNumber(args[2]);
      if (start === null || count === null || start < 1 || count < 0) return "";
      return text(args[0]).slice(start - 1, start - 1 + count);
    },
  },
  {
    name: "TRIM",
    label: "清理空格",
    group: "逻辑与文本",
    signature: "TRIM(A)",
    description: "去掉首尾空白，并把连续空白折叠成一个空格（Excel TRIM 口径）",
    params: "text：任意值（转字符串）",
    returns: "清理后的字符串",
    example: "TRIM('  a   b ') → 'a b'",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => text(args[0]).trim().replace(/\s+/g, " "),
  },
  {
    name: "UPPER",
    label: "转大写",
    group: "逻辑与文本",
    signature: "UPPER(A)",
    description: "把文本转成大写",
    params: "text：任意值（转字符串）",
    returns: "大写字符串",
    example: "UPPER('abc') → 'ABC'",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => text(args[0]).toUpperCase(),
  },
  {
    name: "LOWER",
    label: "转小写",
    group: "逻辑与文本",
    signature: "LOWER(A)",
    description: "把文本转成小写",
    params: "text：任意值（转字符串）",
    returns: "小写字符串",
    example: "LOWER('ABC') → 'abc'",
    minArgs: 1,
    maxArgs: 1,
    run: (args) => text(args[0]).toLowerCase(),
  },
  {
    name: "TODAY",
    label: "今天",
    group: "日期",
    signature: "TODAY()",
    description: "返回本地当天日期",
    params: "无参数",
    returns: "YYYY-MM-DD 格式的日期文本",
    example: "TODAY() → '2026-11-16'",
    minArgs: 0,
    maxArgs: 0,
    run: () => localDateString(false),
  },
  {
    name: "NOW",
    label: "当前时间",
    group: "日期",
    signature: "NOW()",
    description: "返回本地当前日期与时间（到分钟）",
    params: "无参数",
    returns: "YYYY-MM-DD HH:mm 格式的文本",
    example: "NOW() → '2026-11-16 19:30'",
    minArgs: 0,
    maxArgs: 0,
    run: () => localDateString(true),
  },
];

/** 交给受限表达式层的函数表：参数个数在这里统一兜底，避免非法调用产生脏值 */
export const CALCULATION_FUNCTION_MAP: ExpressionFunctionMap = CALCULATION_FUNCTIONS.reduce<
  ExpressionFunctionMap
>((map, fn) => {
  map[fn.name] = (args: unknown[]) => {
    if (args.length < fn.minArgs) return undefined;
    if (fn.maxArgs >= 0 && args.length > fn.maxArgs) return undefined;
    return fn.run(args);
  };
  return map;
}, {});

/** 供设计器渲染函数面板（按分组） */
export function calculationFunctionGroups(): Array<{ group: CalculationFunctionGroup; items: CalculationFunction[] }> {
  const groups: CalculationFunctionGroup[] = ["聚合", "数学", "逻辑与文本", "日期"];
  return groups.map((group) => ({
    group,
    items: CALCULATION_FUNCTIONS.filter((fn) => fn.group === group),
  }));
}
