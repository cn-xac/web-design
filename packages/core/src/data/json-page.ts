/**
 * 业务 JSON → 页面节点树推导（rGjzDs 通用容器能力）。
 *
 * 定位：外部数据源把响应写进 scope 的某个路径后，容器读取该路径的业务对象，
 * 由本模块推导成 NodeSchema[] 交给 SchemaFragment / SchemaNode 渲染。
 * 与 SchemaFragment 的分工：本模块负责「普通业务对象 → 节点树」，
 * SchemaFragment 负责「节点树 → 页面」；两者都不落库，不污染真实 schema。
 *
 * 三条硬约束：
 * 1. 纯函数、零框架依赖、零 eval —— 与表达式引擎同样的安全口径；
 * 2. 节点 ID 必须确定性（由路径派生），否则 scope 每次更新都会重新挂载，
 *    输入框失焦、下拉闪动；
 * 3. 叶子节点把绑定写成 `{{rootPath.field}}`，复用既有 extractPath →
 *    getByPath/setByPath 双向绑定，表单值直接写回 scope，getData 自动带出。
 */

import { createNodeId } from "../schema/tree";
import { materialKey } from "../materials/keys";
import type { NodeSchema } from "../schema/types";
import type { ValidationRule } from "../validation/rules";
import { normalizeRule } from "../validation/rules";

/* ----------------------------- 契约 ----------------------------- */

export type JsonPageMode = "view" | "form";

/** 字段级覆盖规则：控制某字段推导成什么控件、标题、顺序、校验 */
export interface JsonPageFieldRule {
  /** 覆盖推导出的物料 bare key，如 "select" / "date" / "textarea" */
  component?: string;
  label?: string;
  hidden?: boolean;
  order?: number;
  /** 透传给物料的额外属性（如 select 的 options） */
  props?: Record<string, unknown>;
  /** 数据校验规则；非法规则会被 normalizeRule 过滤 */
  rules?: ValidationRule[];
}

export interface JsonPageOptions {
  /** 根路径，用于生成叶子绑定表达式，如 "form.detail" */
  rootPath: string;
  /** view = 只读展示；form = 可编辑表单（默认 form） */
  mode?: JsonPageMode;
  fieldMap?: Record<string, JsonPageFieldRule>;
  /** 排除字段，支持 a.b 路径；数组字段用 a.b[] 表示整个数组 */
  exclude?: string[];
  /** 最大递归深度，防脏数据 / 深层嵌套，默认 4 */
  maxDepth?: number;
}

/* ----------------------------- 工具 ----------------------------- */

/**
 * 确定性节点 ID：同一路径永远得到同一 id。
 * 用 djb2 变体做 32 位散列再转 base36，避免把整条路径塞进 id（过长且含非法字符）。
 * createNodeId 保留给「新建设计节点」，推导树绝不能用随机 id。
 */
function stableId(path: string): string {
  let hash = 5381;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) + hash + path.charCodeAt(i)) | 0;
  }
  return `jp_${(hash >>> 0).toString(36)}`;
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function labelOf(key: string): string {
  return key;
}

/** 整串插值：单个 {{}} 时 resolveValue 会原样透传，这里只需保证路径写法正确 */
function bindingOf(path: string): string {
  return `{{${path}}}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateLike(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2})?)?/.test(text);
}

/** 字段名启发式：只在用户没配 rules 时补格式校验，绝不自动加 required */
function inferredRules(key: string): ValidationRule[] {
  const lower = key.toLowerCase();
  if (/e-?mail|邮箱/.test(lower)) return [{ type: "email" }];
  if (/phone|mobile|tel|手机/.test(lower)) return [{ type: "phone" }];
  return [];
}

function cleanRules(raw: ValidationRule[] | undefined): ValidationRule[] | undefined {
  if (!raw?.length) return undefined;
  const out = raw.map((rule) => normalizeRule(rule)).filter((rule): rule is ValidationRule => Boolean(rule));
  return out.length ? out : undefined;
}

/* ----------------------------- 推导主逻辑 ----------------------------- */

function makeLeaf(
  path: string,
  key: string,
  component: string,
  rule: JsonPageFieldRule | undefined,
): NodeSchema {
  const node: NodeSchema = {
    id: stableId(path),
    component: materialKey(rule?.component || component),
    props: {
      label: rule?.label ?? labelOf(key),
      modelValue: bindingOf(path),
      ...(rule?.props ?? {}),
    },
  };
  const rules = cleanRules(rule?.rules) ?? inferredRules(key);
  if (rules?.length) node.rules = rules;
  return node;
}

/** 按 fieldMap.order 排序，未指定的保持原顺序 */
function orderKeys(keys: string[], fieldMap: Record<string, JsonPageFieldRule> | undefined): string[] {
  if (!fieldMap) return keys;
  const orderOf = (key: string): number => {
    const hit = fieldMap[key];
    if (hit?.order !== undefined) return hit.order;
    const full = Object.entries(fieldMap).find(([path, rule]) => path.endsWith(`.${key}`) && rule?.order !== undefined);
    return full ? (full[1].order ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  };
  return keys
    .map((key, index) => ({ key, index, order: orderOf(key) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.key);
}

/**
 * 把任意业务 JSON 推导成节点树。
 *
 * @param value 业务数据对象 / 数组 / 原始值
 * @param options 根路径、模式、字段覆盖
 * @returns 节点数组；脏值（undefined / null / 非对象顶层）返回空数组
 */
export function derivePageFromJson(value: unknown, options: JsonPageOptions): NodeSchema[] {
  const rootPath = String(options.rootPath ?? "").trim();
  if (!rootPath) return []; // 没有根路径就没有绑定目标，推导无意义
  if (value === undefined || value === null) return [];

  const mode: JsonPageMode = options.mode === "view" ? "view" : "form";
  const fieldMap = options.fieldMap ?? {};
  const exclude = new Set(options.exclude ?? []);
  const maxDepth = Math.max(1, Number(options.maxDepth ?? 4));

  /** fieldMap 键支持全路径（form.detail.age）与裸字段名（age）两种写法 */
  const ruleFor = (path: string, key: string): JsonPageFieldRule | undefined =>
    fieldMap[path] ?? fieldMap[`${path}[]`] ?? (key ? fieldMap[key] : undefined);
  /** exclude 同样支持全路径与裸字段名 */
  const isExcluded = (path: string, key: string): boolean =>
    exclude.has(path) || exclude.has(`${path}[]`) || (Boolean(key) && exclude.has(key));

  const deriveValue = (raw: unknown, path: string, key: string, depth: number): NodeSchema | null => {
    if (depth > maxDepth) return null;
    if (isExcluded(path, key)) return null;

    const rule = ruleFor(path, key);
    if (rule?.hidden) return null;

    // 数组：对象数组 → 子表单（可编辑行）/ 表格（只读）；原始值数组 → 多选 / 文本
    if (Array.isArray(raw)) {
      if (raw.length && raw.every(isObject)) {
        const component = mode === "form" ? "subform" : rule?.component || "table";
        // 子表单 itemPath 相对渲染时的 BINDING_BASE；顶层注入为 "form"，
        // 因此把 rootPath 去掉 form. 前缀后拼上当前字段名，确保落到 form.detail.items[i]。
        const relative = path.replace(/^form\./, "");
        const node: NodeSchema = {
          id: stableId(path),
          component: materialKey(rule?.component || component),
          props: {
            label: rule?.label ?? labelOf(key),
            itemPath: relative,
            ...(rule?.props ?? {}),
          },
        };
        // 子表单自身绑定整个数组；行内字段相对当前行绑定，路径用 [] 占位，
        // 由 SchemaSubForm 按行注入 bindingBase，天然落到 rootPath.field[i].sub。
        const sample = raw[0] as Record<string, unknown>;
        const children = deriveObject(sample, `${path}[]`, "", depth + 1, "items");
        if (children.length) node.children = children;
        return node;
      }
      const primitive = mode === "form" ? "select" : "text";
      const node = makeLeaf(path, key, primitive, rule);
      if (mode === "form" && !rule?.props?.options) {
        // 用响应值自身作为候选项：label / value 都取原值，保证回填语义一致
        node.props!.options = raw.map((item) => ({ label: String(item), value: String(item) }));
        node.props!.multiple = true;
      } else if (mode === "view") {
        node.props!.text = raw.map((item) => String(item)).join("、");
      }
      return node;
    }

    // 对象：容器递归子字段
    if (isObject(raw)) {
      const node: NodeSchema = {
        id: stableId(path),
        component: materialKey(rule?.component || "container"),
        props: { label: rule?.label ?? labelOf(key), ...(rule?.props ?? {}) },
      };
      const children = deriveObject(raw, path, "", depth + 1);
      if (children.length) node.children = children;
      return node;
    }

    // 原始值：按类型选控件
    let component: string;
    if (typeof raw === "number") component = mode === "form" ? "number" : "text";
    else if (typeof raw === "boolean") component = mode === "form" ? "switch" : "tag";
    else {
      const text = String(raw);
      component = mode === "form" ? (isDateLike(text) ? "date" : "input") : "text";
    }
    const node = makeLeaf(path, key, component, rule);
    if (mode === "view") {
      node.props!.text = typeof raw === "boolean" ? String(raw) : String(raw);
    }
    return node;
  };

  /** 把对象展开成子节点数组；inlineKey 非空时表示在子表单行内（相对绑定） */
  const deriveObject = (
    obj: Record<string, unknown>,
    basePath: string,
    _unused: string,
    depth: number,
    inlineKey?: string,
  ): NodeSchema[] => {
    if (depth > maxDepth) return [];
    const keys = orderKeys(Object.keys(obj), fieldMap);
    const out: NodeSchema[] = [];
    for (const key of keys) {
      const value = obj[key];
      if (inlineKey) {
        // 子表单行内字段：不写显式 modelValue，让节点走 BINDING_BASE 自动绑定。
        // 子表单把 BINDING_BASE 注入为 `rootPath.items[i]`，而自动绑定路径 = `${base}.${node.id}`，
        // 所以节点 id 必须就是业务字段名（sku → form.detail.items[i].sku）。
        const rule = ruleFor(`${basePath}.${key}`, key);
        if (rule?.hidden || isExcluded(`${basePath}.${key}`, key)) continue;
        const node: NodeSchema = {
          id: key, // 字段名即绑定键，不能用 stableId，否则数据列对不上
          component: materialKey(rule?.component || inferPrimitiveComponent(value, mode)),
          props: { label: rule?.label ?? labelOf(key), ...(rule?.props ?? {}) },
        };
        const rules = cleanRules(rule?.rules) ?? inferredRules(key);
        if (rules?.length) node.rules = rules;
        out.push(node);
      } else {
        const full = joinPath(basePath, key);
        const node = deriveValue(value, full, key, depth);
        if (node) out.push(node);
      }
    }
    return out;
  };

  // 顶层必须是对象或对象数组，否则没有「字段」概念
  if (Array.isArray(value) && value.length && value.every(isObject)) {
    const node = deriveValue(value, rootPath, "", 1);
    return node ? [node] : [];
  }
  if (!isObject(value)) return [];
  return deriveObject(value, rootPath, "", 1);
}

/** 子表单行内字段按值推断控件（行内绑定是相对路径，不走 rootPath） */
function inferPrimitiveComponent(value: unknown, mode: JsonPageMode): string {
  if (typeof value === "number") return mode === "form" ? "number" : "text";
  if (typeof value === "boolean") return mode === "form" ? "switch" : "tag";
  if (Array.isArray(value)) return mode === "form" ? "select" : "text";
  if (isObject(value)) return "container";
  return mode === "form" ? "input" : "text";
}

/* ----------------------------- 校验字段收集 ----------------------------- */

/**
 * 收集推导树里的表单字段，供渲染层把 derived fields 注入 validateData。
 * 逻辑与 collectFields 对齐：子表单按行下钻，普通表单控件由 describeField 识别。
 */
export function collectDerivedFields(
  nodesByOwner: Map<string, NodeSchema[]> | Record<string, NodeSchema[]>,
  scope: Record<string, unknown>,
  describe: (node: NodeSchema, scope: Record<string, unknown>) => unknown,
): unknown[] {
  const entries = nodesByOwner instanceof Map ? [...nodesByOwner.values()] : Object.values(nodesByOwner);
  const out: unknown[] = [];
  const walk = (nodes: NodeSchema[], base: string): void => {
    for (const node of nodes) {
      const field = describe(node, scope);
      if (field) out.push(field);
      if (node.children) walk(node.children, base);
    }
  };
  for (const nodes of entries) walk(nodes, "form");
  return out;
}

/** 供渲染层生成 id 时复用：判断 id 是否推导节点（设计器不应把它当真实节点选中） */
export function isDerivedNodeId(id: string): boolean {
  return id.startsWith("jp_");
}

/** 暴露随机 id 生成器给「误用」场景做兜底对比（测试用，不在生产推导路径调用） */
export { createNodeId as createDesignNodeId };
