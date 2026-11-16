/**
 * 外部数据源（对应待办 rg4KCt）。
 *
 * 定位：把一个 HTTP 接口配置成页面可消费的数据，能力覆盖
 * 「输入框 / 下拉选择等场景中作为数据来源使用」。
 *
 * 三条设计约束（决定了下面的实现形状）：
 *
 * 1. **配置集中在页面级**（page.externalSources，键为 id），节点只用 `externalRef` 引用。
 *    既避免同一份取数配置在多个元素上重复书写，也让「一个源喂多个元素」天然成立；
 *    响应映射各自写不同 scope 路径即可，与既有表达式机制同构。
 *
 * 2. **结果统一写进 scope 的一个路径**，元素再通过 {{}} 读它。
 *    这样「响应映射到某个元素」= 把 scopePath 指向该元素的绑定路径，
 *    与既有的表达式机制完全同构，渲染器不需要为外部数据源开任何特例。
 *
 * 3. **取数走 core 的 request 层 + provider 缓存**，
 *    「只请求一次」就是页面级 TTL 缓存（不过期），「每次都取」就是 ttl = 0 不入缓存。
 */

import type { Method } from "../request/types";
import { getByPath, resolveValue, setByPath } from "../schema/expression";
import type { Scope } from "../schema/expression";
import type { NodeSchema, PageSchema } from "../schema/types";
import type { BindingContext, DataBinding, DataShape } from "./types";
import { getProvider } from "./registry";
import { normalize, toOption } from "./normalize";
import { collectBindableElements } from "./bindable";

/* ----------------------------- 配置契约 ----------------------------- */

/**
 * 请求参数映射项。
 * - key：接口参数名；
 * - path：取值路径，指向当前页面某个元素的值（形如 form.keyword）。
 *
 * 「仅限当前页面选择元素」由设计器保证：它只会吐出页面上真实存在的元素路径。
 * 「支持将整个子表单作为单个参数值」= path 指向明细数组本身（如 form.items）。
 */
export interface ExternalParamMap {
  key: string;
  path: string;
  /** 展示名，写进 Schema 便于阅读；不影响运行时 */
  label?: string;
}

/**
 * 子映射项（响应目标为子表单时，映射明细行内的字段）。
 * - field：子表单内的字段（相对明细数组），主映射的父字段名由 parentField 给出；
 * - from：响应行对象里取值的字段名。
 */
export interface ExternalSubMap {
  /** 子表单内的字段名（支持 a.b 嵌套） */
  field: string;
  /** 响应行里取值的字段名（支持 a.b 嵌套） */
  from: string;
}

/** 响应数据映射（一条） */
export interface ExternalResponseMap {
  /** 结果写入 scope 的路径。映射到某个元素时 = 该元素的绑定路径 */
  scopePath: string;
  /** 从响应里取出数组的字段名（如 data.list） */
  listField?: string;
  /** 选项形态：label 取值字段（缺省 label） */
  labelField?: string;
  /** 选项形态：value 取值字段（缺省 value；选项数据源缺省则回退到 label） */
  valueField?: string;
  /** 归一化形态；缺省由目标元素类型推断（选项类 → select，否则 form） */
  shape?: DataShape;
  /**
   * 显示内容模板（#3）：用 {{}} 从响应数据取数并自由拼接，如 `{{data.a}}/{{data.b}}`。
   * - 选项形态：逐项渲染，结果作为该选项的展示文本（值仍按 valueField 映射）；
   * - 表单形态：渲染整段响应，结果作为写入目标路径的字符串。
   *
   * 求值上下文 = 页面 scope + `data`（本次响应数据），响应的一级字段也会平铺到顶层，
   * 因此 `{{data.a}}` 与 `{{a}}` 两种写法都能取到响应里的值。
   */
  display?: string;
  /**
   * 父字段名（响应目标为子表单时）：明细数组所在的字段名，如 items。
   * 与 subMaps 配合：主映射给出父字段，子映射只需填「父字段里的子字段」。
   */
  parentField?: string;
  /**
   * 子映射（响应目标为子表单时）：响应数组的每一行按这些映射填成明细对象。
   * 未配置时整个响应数组原样写入。
   */
  subMaps?: ExternalSubMap[];
}

export interface ExternalDataSource {
  /** 数据源唯一 id（页面级 externalSources 的键）；由设计器生成，运行时按 id 反查触发节点 */
  id: string;
  /** 数据源名称，仅用于展示 */
  name?: string;
  /** 请求方法；缺省 GET */
  method?: Method;
  /** 请求地址 */
  url: string;
  /** 请求头（独立弹窗设置） */
  headers?: Record<string, string>;
  /** 请求参数映射：值来自页面上选中的元素 */
  params?: ExternalParamMap[];
  /**
   * 响应数据里数组所在的字段名（如 `data.list`）。
   *
   * 顶层统一配置：一次响应通常只有一个数组，各响应映射都基于这个数组逐项生成，
   * 映射里的 labelField / valueField / display 只描述「数组里的一项怎么映射」。
   * `responses[].listField` 仍保留用于兼容旧 Schema；两者同时存在时以映射级为准。
   */
  listField?: string;
  /**
   * 响应数据映射（可多条，#4）。
   * 每条各自写不同的 scope 路径，形态 / label / value 独立，
   * 例如一条写 `external.deptList`（选项），一条写 `external.summary`（整段对象）。
   */
  responses?: ExternalResponseMap[];
  /**
   * @deprecated 旧版单条响应映射，仅供读取早期 Schema 时兼容。
   * 新写入一律走 `responses` 数组；`responsesOf()` 会自动把本条提升为数组。
   */
  response?: ExternalResponseMap;
  /**
   * 标记本数据源是「选项数据源」（#5）：响应恒为选项形态，由下拉 / 单选等元素直接消费，
   * 不再需要逐条选响应形态；仅配置 label / value 映射即可。
   */
  asOptions?: boolean;
  /** 只请求一次（当前页面仅请求一次）；缺省 true */
  once?: boolean;
  /** 触发长度：输入达到该长度才发请求；0 / 缺省 = 页面加载即取 */
  triggerLength?: number;
  /**
   * 触发型数据源的防抖延时（毫秒）：输入停止该时长后才真正请求，避免逐字打接口。
   * 缺省取 EXTERNAL_TRIGGER_DEBOUNCE_MS；设 0 表示不防抖（每次变化立即请求）。
   */
  debounceMs?: number;
  /**
   * @deprecated 触发元素固定为「绑定该源的节点」，运行时按该节点自身的绑定路径取触发值；
   * 此字段仅保留兼容旧 Schema，新配置不再写入。
   */
  triggerPath?: string;
}

/**
 * 兼容读取响应映射：新结构用 `responses` 数组；旧结构单条 `response` 自动提升为数组。
 * 既支持本次重构后的多响应，也不至于让早期 Schema 直接失效。
 */
export function responsesOf(source: ExternalDataSource | undefined): ExternalResponseMap[] {
  if (!source) return [];
  if (Array.isArray(source.responses)) {
    return source.responses.filter((item): item is ExternalResponseMap => Boolean(item?.scopePath));
  }
  if (source.response?.scopePath) return [source.response];
  return [];
}

/* ----------------------------- 工具 ----------------------------- */

/** 外部数据源的默认响应路径：external.<name> */
export function defaultScopePath(name?: string): string {
  // 保留中英文与数字，只去掉会让路径难读的符号
  const key = (name ?? "").trim().replace(/[^\w$一-龥]/g, "") || "data";
  return `external.${key}`;
}

/** 是否「只请求一次」；缺省为 true（页面级取数最常见的诉求） */
export function isOnceOnly(source: ExternalDataSource): boolean {
  return source.once !== false;
}

/**
 * 触发判定：输入长度达到阈值才算触发。
 * 缺省阈值（0 / 未设）表示「页面加载即取」，不由输入触发。
 */
export function reachesTriggerLength(source: ExternalDataSource, value: unknown): boolean {
  const threshold = Number(source.triggerLength ?? 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  const text = value === null || value === undefined ? "" : String(value);
  return text.length >= threshold;
}

/**
 * 渲染层触发型外部数据源的默认防抖延时（毫秒）。
 * 用户逐字输入时合并为末次请求，避免「输入就打接口」；两端共用同一默认，体验一致。
 */
export const EXTERNAL_TRIGGER_DEBOUNCE_MS = 300;

/** 读取触发型数据源的防抖延时：未配置取默认，显式 0 保留 */
export function externalDebounceMs(source: ExternalDataSource): number {
  return typeof source.debounceMs === "number" && Number.isFinite(source.debounceMs) && source.debounceMs >= 0
    ? source.debounceMs
    : EXTERNAL_TRIGGER_DEBOUNCE_MS;
}

export type ExternalTriggerReason = "below-threshold" | "duplicate" | "fetch";
export interface ExternalTriggerDecision {
  shouldFetch: boolean;
  reason: ExternalTriggerReason;
  /** 当前值转成用于判重的文本；调用方据此更新「上次值」 */
  text: string;
}

/**
 * 触发型外部数据源的调度判定（Vue / React 两端共用的唯一口径）。
 *
 * 渲染层不直接读 `once` / `triggerLength`，统一调用本函数，避免两端语义漂移：
 * - 未达触发长度 → 不取数（并清掉「上次值」记录，保证清空后重输同值能再次触发）；
 * - 值与上次相同 → 不取数（防请求风暴：输入逐字 watch / React version 抖动都会重复进入）；
 * - 其余 → 取数。
 *
 * 「只请求一次」(once=true) 的额外保证在 provider 缓存层（TTL 不过期）；
 * once=false 时 binding.cache 为 ttl:0，每次真取。防抖延时由渲染层按框架实现。
 */
export function decideExternalTrigger(
  source: ExternalDataSource,
  lastText: string | undefined,
  value: unknown,
): ExternalTriggerDecision {
  const text = value === null || value === undefined ? "" : String(value);
  if (!reachesTriggerLength(source, value)) {
    return { shouldFetch: false, reason: "below-threshold", text };
  }
  if (lastText === text) {
    return { shouldFetch: false, reason: "duplicate", text };
  }
  return { shouldFetch: true, reason: "fetch", text };
}

/**
 * 把外部数据源翻译成 core 的 DataBinding。
 *
 * 关键决策：binding 一律取「原始响应」（shape = 'form'），参数的 {{}} 绑定照常解析；
 * 各响应映射的「选项 / 表单」形态、label / value / listField 归一化，
 * 放到 loadExternalSource 里按每条响应分别做（见 normalizeResponse）。
 * 这样多条响应（各自不同形态）可以共用同一次缓存请求，互不干扰。
 */
export function toDataBinding(source: ExternalDataSource): DataBinding {
  const params: Record<string, unknown> = {};
  for (const item of source.params ?? []) {
    if (!item?.key) continue;
    params[item.key] = item.path ? `{{${item.path}}}` : "";
  }

  return {
    type: "http",
    url: source.url,
    method: source.method ?? "GET",
    headers: source.headers,
    params,
    // 原始响应：各响应的形态在 loadExternalSource 内分别归一化
    shape: "form",
    // 「只请求一次」= 不过期；否则 ttl 0 表示不入缓存，每次都真取
    cache: isOnceOnly(source) ? {} : { ttl: 0 },
    trigger: source.triggerLength ? "manual" : "load",
  };
}

/**
 * 按单条响应配置把「原始响应」归一化为目标形态。
 * - shape = 'form'：原样返回（已转换后的对象）；
 * - 选项形态（select/radio/checkbox）：经 listField 取数组，再按 label/value 映射。
 *
 * valueField 缺省时的回退规则：
 * - 选项数据源（asOptions，#5）：未配值字段 → 值默认等于名称（label）；
 * - 其它外部数据源：沿用通用约定，值默认取对象的 value 字段。
 *
 * 配了 display（显示内容模板，#3）时：
 * - 选项形态：逐项渲染模板，渲染结果作为该项的展示文本（值仍按 valueField 映射）；
 * - 表单形态：渲染整段响应，渲染结果作为写入目标路径的字符串。
 */
function normalizeResponse(
  raw: unknown,
  response: ExternalResponseMap,
  fallbackValueToLabel: boolean,
  scope: Scope,
  sourceListField?: string,
): unknown {
  const labelField = response.labelField ?? "label";
  const valueField = response.valueField || (fallbackValueToLabel ? labelField : "value");
  // 映射级优先，其次回退到数据源级（列表字段已上提到顶层统一配置）
  const listField = response.listField ?? sourceListField;
  const binding: DataBinding = {
    type: "http",
    url: "",
    shape: response.shape ?? "form",
    listField,
    labelField,
    valueField,
  };

  const template = response.display?.trim();

  // 子映射（响应目标为子表单时，#4）：逐行把响应数组映射成明细对象
  if (response.subMaps?.length) {
    let rows: unknown = raw;
    if (listField && raw && typeof raw === "object") {
      const extracted = getByPath(raw as Record<string, unknown>, listField);
      if (Array.isArray(extracted)) rows = extracted;
    }
    if (!Array.isArray(rows)) rows = [];

    return (rows as unknown[]).map((row) => {
      const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const out: Record<string, unknown> = {};
      for (const map of response.subMaps!) {
        if (!map.field) continue;
        const value = map.from ? getByPath(source, map.from) : undefined;
        setByPath(out, map.field, value);
      }
      return out;
    });
  }

  if (!template) {
    return normalize(binding, raw, { scope });
  }

  // 表单形态：模板渲染「一段」响应。
  // 数组响应只取第一条（listField 可先提取数组），否则多条数据下模板取不到任何字段、结果为空串。
  if ((binding.shape ?? "form") === "form") {
    let target: unknown = raw;
    if (binding.listField && raw && typeof raw === "object") {
      const extracted = getByPath(raw as Record<string, unknown>, binding.listField);
      if (extracted !== undefined) target = extracted;
    }
    if (Array.isArray(target)) target = target[0] ?? {};
    return renderDisplay(template, target, scope);
  }

  // 选项形态：逐项渲染，值仍按 label/value 字段映射。
  // 响应不一定是数组：单条对象（如「个人档案」）也要成为一条候选项，
  // 否则「列表字段不填 / 填了不存在的字段」都会得到空候选，用户以为设置没生效。
  let list: unknown = raw;
  if (binding.listField && raw && typeof raw === "object") {
    const extracted = getByPath(raw as Record<string, unknown>, binding.listField);
    if (extracted !== undefined) list = extracted;
  }
  if (!Array.isArray(list)) {
    list = list === undefined || list === null ? [] : [list];
  }

  return (list as unknown[]).map((item) => {
    const option = toOption(item, binding);
    const label = renderDisplay(template, item, scope);
    // 响应里没有可用的值字段时回退到展示文本：否则 value 为空会在 parseOptions 里被过滤掉，
    // 表现就是「配了候选却一个选项都没有」。
    return { ...option, label, value: option.value || label };
  });
}

/**
 * 渲染显示内容模板。
 * 上下文 = 页面 scope + `data`（响应数据）；响应的一级字段平铺到顶层（data 键除外）。
 */
function renderDisplay(template: string, data: unknown, scope: Scope): string {
  const ctx: Scope = { ...scope, data };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key === "data") continue;
      ctx[key] = value;
    }
  }
  const out = resolveValue(template, ctx);
  return out === null || out === undefined ? "" : String(out);
}

/* ----------------------------- 运行时 ----------------------------- */

export interface LoadExternalOptions {
  /** provider 名；缺省 default */
  provider?: string;
  signal?: AbortSignal;
  /**
   * 候选持有者的绑定路径（如 form.x_emp）。
   * 用于「只有一条候选」时自动选中并写回源输入框，等价于直接回填。
   */
  ownerPath?: string;
  onError?: (message: string, source: ExternalDataSource) => void;
}

/** 一行候选：label 用来匹配「源输入框」的值，writes 是选中后要写入的其它目标 */
interface FillRow {
  label: string;
  writes: Array<{ path: string; value: unknown }>;
}

/** scope → sourceId → 回填表。用 WeakMap 存，既不进 scope 也不影响数据导出 */
const fillTables = new WeakMap<object, Map<string, FillRow[]>>();

/** 取响应里的数组：顶层 listField 优先；非数组（单对象）包成一条 */
function extractRows(raw: unknown, listField?: string): unknown[] {
  let list: unknown = raw;
  if (listField && raw && typeof raw === "object") {
    const extracted = getByPath(raw as Record<string, unknown>, listField);
    if (extracted !== undefined) list = extracted;
  }
  if (Array.isArray(list)) return list;
  return list === undefined || list === null ? [] : [list];
}

/** 从一行记录里取出某个映射要写的值（有 display 走模板，否则按 value/label 字段） */
function rowValue(row: unknown, response: ExternalResponseMap, scope: Scope): unknown {
  const template = response.display?.trim();
  if (template) return renderDisplay(template, row, scope);
  const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const field = response.valueField || response.labelField || "value";
  const hit = getByPath(record, field);
  return hit === undefined ? row : hit;
}

/**
 * 把「选中值」对应那一行的其它映射写进 scope。
 *
 * 由渲染层的 watcher 在「候选持有者的值」变化时调用：用户在下拉里选中一条，
 * 就把这条记录里其它字段回填到配置的目标元素（例如选中员工 → 回填个人档案）。
 * 值被清空时一并清掉回填目标，避免留下上一次的脏数据。
 */
export function applyExternalFill(scope: Scope, sourceId: string, value: unknown): void {
  const table = fillTables.get(scope)?.get(sourceId);
  if (!table?.length) return;
  const text = value === null || value === undefined ? "" : String(value);
  const row = table.find((item) => item.label === text);
  if (!row) {
    if (!text) for (const write of table[0]!.writes) setByPath(scope, write.path, undefined);
    return;
  }
  for (const write of row.writes) setByPath(scope, write.path, write.value);
}

/**
 * 加载单个外部数据源。
 *
 * 取一次原始响应（走参数 {{}} 绑定 + 页面级缓存），再按 `responses` 归一化写入。
 *
 * 两种形态：
 * - **有候选源**（映射里存在 `options.<节点ID>` 的 select 映射）：把列表字段里的数组
 *   逐项变成候选项写进 `options.<节点ID>`，其余映射按「行 → 目标」预计算成回填表，
 *   等用户选中某条时再由 `applyExternalFill` 写入（单条候选则直接回填）；
 * - **没有候选源**：各映射直接按旧行为写各自的 scopePath。
 *
 * 取数失败不抛错：保留原值，只通过 onError 上报，页面不会白屏。
 */
export async function loadExternalSource(
  source: ExternalDataSource,
  scope: Scope,
  options: LoadExternalOptions = {},
): Promise<unknown> {
  if (!source?.url) return undefined;

  const ctx: BindingContext = { scope };
  const binding = toDataBinding(source);

  try {
    const provider = getProvider(options.provider ?? "default");
    const raw = await provider.load(binding, ctx);
    const responses = responsesOf(source);

    // 候选源：写到 options.<节点ID> 的 select 映射（输入框的候选下拉）
    const candidate = responses.find(
      (item) => (item.shape ?? "form") === "select" && /^options\.[^.]+$/.test(item.scopePath),
    );

    if (!candidate) {
      for (const response of responses) {
        const mapped = normalizeResponse(raw, response, Boolean(source.asOptions), scope, source.listField);
        setByPath(scope, response.scopePath, mapped);
      }
      options.onError?.("", source);
      return raw;
    }

    // 有候选：生成候选项 + 回填表；选中某条时再由 watcher 写其它目标
    const rows = extractRows(raw, source.listField);
    const labelField = candidate.labelField ?? "label";
    const valueField = candidate.valueField || "value";
    const items = rows.map((row) => {
      const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const label = candidate.display?.trim()
        ? renderDisplay(candidate.display, row, scope)
        : String(getByPath(record, labelField) ?? "");
      const value = String(getByPath(record, valueField) ?? "") || label;
      return { label, value };
    });
    setByPath(scope, candidate.scopePath, items);

    const fills = responses.filter((item) => item !== candidate);
    const table: FillRow[] = rows.map((row, index) => ({
      label: items[index]?.label ?? "",
      writes: fills.map((fill) => ({ path: fill.scopePath, value: rowValue(row, fill, scope) })),
    }));
    if (!fillTables.has(scope)) fillTables.set(scope, new Map());
    fillTables.get(scope)!.set(source.id, table);

    // 只有一条候选 = 等价于「直接回填」：自动写其它目标，并在源输入框为空时选中它
    if (table.length === 1) {
      for (const write of table[0]!.writes) setByPath(scope, write.path, write.value);
      const only = items[0];
      if (options.ownerPath && only && !getByPath(scope, options.ownerPath)) {
        setByPath(scope, options.ownerPath, only.label);
      }
    }

    options.onError?.("", source);
    return raw;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return undefined;
    const message = `外部数据源${source.name ? `「${source.name}」` : ""}加载失败：${(error as Error).message}`;
    options.onError?.(message, source);
    console.warn(`[web-design][external] ${message}`, error);
    return undefined;
  }
}

/* ----------------------------- 页面级遍历 ----------------------------- */

/** 反查「触发 / 拥有」某条页面级外部数据源的节点（externalRef === source.id） */
function findTriggerNode(page: PageSchema, sourceId: string): NodeSchema | undefined {
  let found: NodeSchema | undefined;
  const walk = (nodes: NodeSchema[]): void => {
    for (const node of nodes ?? []) {
      if (node.externalRef === sourceId) {
        found = node;
        return;
      }
      walk(node.children ?? []);
      if (found) return;
    }
  };
  walk(page.children ?? []);
  return found;
}

/**
 * 遍历页面级外部数据源，返回每条 { node, source }。
 * node 为「触发 / 拥有」该源的节点（externalRef === source.id），运行时据此按节点解析默认触发路径；
 * 找不到触发节点时为 undefined（此时触发路径必须显式配置）。
 */
export function collectExternalSources(
  page: PageSchema,
): Array<{ node: NodeSchema | undefined; source: ExternalDataSource }> {
  const out: Array<{ node: NodeSchema | undefined; source: ExternalDataSource }> = [];
  for (const source of Object.values(page.externalSources ?? {})) {
    if (!source?.url) continue;
    out.push({ node: findTriggerNode(page, source.id), source });
  }
  return out;
}

/** 页面里是否存在外部数据源（渲染器据此决定要不要挂触发监听） */
export function hasExternalSource(page: PageSchema): boolean {
  return Object.values(page.externalSources ?? {}).some((s) => Boolean(s?.url));
}

/**
 * 加载页面里全部外部数据源。
 * 串行执行：同一页面通常只有一两个源，串行能避免并发写 scope 造成的顺序抖动。
 */
export async function loadExternalSources(
  page: PageSchema,
  scope: Scope,
  options: LoadExternalOptions = {},
): Promise<void> {
  const list = collectExternalSources(page);
  if (!list.length) return;

  const elementPaths = new Map(collectBindableElements(page).map((item) => [item.nodeId, item.path]));
  for (const { node, source } of list) {
    // 触发型数据源（triggerLength > 0）不在这里加载：等用户输入够长度再触发
    if (Number(source.triggerLength ?? 0) > 0) continue;
    await loadExternalSource(source, scope, {
      ...options,
      ownerPath: node ? elementPaths.get(node.id) : undefined,
    });
  }
}

/** 读取某个路径上的当前值（触发判定用） */
export function readTriggerValue(scope: Scope, path?: string): unknown {
  if (!path) return undefined;
  return getByPath(scope, path);
}

/** 求值外部数据源的参数（设计器预览 / 运行时共用） */
export function resolveExternalParams(source: ExternalDataSource, scope: Scope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of source.params ?? []) {
    if (!item?.key) continue;
    out[item.key] = item.path ? resolveValue(`{{${item.path}}}`, scope) : undefined;
  }
  return out;
}
