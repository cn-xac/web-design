/**
 * 物料公用解析器（框架无关）。
 *
 * 这些函数原先住在 design-vue-element-plus 的 src/utils/parse.ts，
 * 但它们只做字符串 → 结构数据的转换，不认识 Vue / React / 任何 UI 库，
 * 且 vue-icon-* / react-ant 等扩展仓都需要同一套写法。按「通用工具进 core」上移。
 *
 * 为什么用字符串而不是结构化编辑器：折叠面板、标签页、步骤条这类组件的价值全在
 * 「有多少项、每项写什么」。字符串在 Schema 里可读、可 diff、可手写。
 */

import { parseOptionLines, type OptionItem } from "./utils";

export interface PairItem {
  label: string;
  value: string;
}

/** 中英文逗号、分号都当分隔符：用户不会记得只能写英文逗号 */
const ENTRY_SPLIT = /[,，;；\n]/;
const PAIR_SPLIT = /[:：]/;

/**
 * 解析 `标签:值` 列表。
 * - `标题:内容` → [{ label: "标题", value: "内容" }]
 * - `只有一项` → [{ label: "只有一项", value: "" }]
 * 值里允许再出现冒号（只按第一个冒号切），URL、时间戳都能正常用。
 */
export function parsePairs(raw: unknown): PairItem[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { label: String(record.label ?? record.title ?? ""), value: String(record.value ?? record.content ?? "") };
    });
  }
  if (typeof raw !== "string" || !raw.trim()) return [];

  return raw
    .split(ENTRY_SPLIT)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.search(PAIR_SPLIT);
      if (at < 0) return { label: entry, value: "" };
      return { label: entry.slice(0, at).trim(), value: entry.slice(at + 1).trim() };
    });
}

/**
 * 结构化标签项：标签页 items 从「标题:内容」字符串升级后的形态。
 *
 * 为什么保留字符串入口：历史页面把 tabs 的 items 存成成对字符串，
 * 直接改协议会让旧页面渲染不出来。parseTabItems 负责把两种形态归一，
 * 运行时与设计器只认 TabItem[]，不再各自判空。
 */
export type TabContentKind = "design" | "text" | "dataPath" | "url";

export interface TabItem {
  /** 稳定标识：拖拽排序 / 增删改都以它为准，不能随下标漂移 */
  id: string;
  label: string;
  /** 自定义标记：用于「按数据控制默认激活哪个页签」 */
  mark?: string;
  /**
   * 内容来源。缺省按 dataPath → url → text 推断；旧结构没有此字段。
   * - design：由 pane 容器里的设计节点承载（可拖拽编辑 / 数据驱动）；
   * - text：纯文本，只兼容读取旧 Schema，设计器不再提供新建入口（要用文本请用文本标签节点）。
   */
  content?: TabContentKind;
  /** 纯文本内容（旧字符串的 value 落到这里） */
  text?: string;
  /** 绑定数据里的 schema 路径，运行时按 schema 协议解析为页面 */
  dataPath?: string;
  /** 外部 URL：返回 schema JSON，运行时拉取后按 schema 协议解析为页面 */
  url?: string;
  method?: "get" | "post";
}

/**
 * 生成标签项 id。只在「新建」时调用：
 * 已存在的项必须沿用原 id，否则拖拽排序后 key 漂移、输入框失焦、内容重挂载。
 */
export function createTabId(prefix = "tab"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 归一化标签页 items。
 * - 结构化数组：逐项补齐 id / label / mark / text / dataPath / url，缺 id 用 `tab{index}` 兜底；
 * - 旧成对字符串：走 parsePairs，内容落到 text；
 * - 其它脏值：返回空数组，绝不抛错。
 *
 * 与 parsePairs 的分工：parsePairs 只产出 {label,value}（显示层面的最小契约），
 * parseTabItems 在其之上补齐 id / mark / 内容来源，供设计器弹窗与运行时内嵌渲染使用。
 */
export function parseTabItems(raw: unknown): TabItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry, index) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        const label = String(record.label ?? record.title ?? "").trim();
        const item: TabItem = { id: String(record.id ?? `tab${index}`), label };

        const mark = record.mark ?? record.tag;
        if (mark !== undefined && mark !== null && String(mark) !== "") item.mark = String(mark);

        // 注意：record.content 在旧结构里可能是纯文本字符串。新结构 content 是来源枚举，
        // 只有取到合法枚举值才当成来源，否则一律当文本，避免把正文误读成来源类型。
        const validKinds: TabContentKind[] = ["design", "text", "dataPath", "url"];
        if (typeof record.content === "string" && validKinds.includes(record.content as TabContentKind)) {
          item.content = record.content as TabContentKind;
        }
        const text = record.text ?? record.value ?? (typeof record.content === "string" && !item.content ? record.content : undefined);
        if (text !== undefined && text !== null) item.text = String(text);

        if (record.dataPath) item.dataPath = String(record.dataPath);
        if (record.url) item.url = String(record.url);
        if (record.method === "get" || record.method === "post") item.method = record.method;

        return item;
      })
      .filter((item) => item.label !== "");
  }

  return parsePairs(raw).map((pair, index) => ({ id: `tab${index}`, label: pair.label, text: pair.value }));
}

/** 只要标签（面包屑、分段控制器这类只需要一项文字） */
export function parseLabels(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    // 数组可能是选项数据源绑定后的 [{label,value}]：取名称，不要 String(对象)
    return raw
      .map((item) => {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return String(obj.label ?? obj.value ?? "");
        }
        return String(item ?? "");
      })
      .filter(Boolean);
  }
  if (typeof raw !== "string") return [];
  return raw
    .split(ENTRY_SPLIT)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface TreeNode {
  value: string;
  label: string;
  children?: TreeNode[];
}

/**
 * 解析层级路径成树，给级联选择 / 树选择用。
 *
 * 写法与其它选项类组件统一：**每个选项的名称即路径**（`/` 或 `>` 分层），
 * 叶子节点的值取选项自己的值（没给值就用路径本身）：
 * - 字符串：一行一条「名称 值」，与选项弹窗录入的格式一致；
 * - 数组：选项数据源绑定后就是这个形态（取每项名称作路径、值作叶子值）。
 *
 * 重复的中间节点自动合并。
 */
export function parsePaths(raw: unknown): TreeNode[] {
  const items = toPathItems(raw);
  const roots: TreeNode[] = [];
  const index = new Map<string, TreeNode>();

  for (const item of items) {
    const parts = item.label.split(/[/>]/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) continue;
    let parentChildren = roots;
    let path = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      path = path ? `${path}/${part}` : part;
      let node = index.get(path);
      if (!node) {
        const isLeaf = i === parts.length - 1;
        node = { value: isLeaf && item.value ? item.value : path, label: part };
        index.set(path, node);
        parentChildren.push(node);
      }
      if (!node.children) node.children = [];
      parentChildren = node.children;
    }
  }

  // 叶子节点不留空 children，否则级联选择会画出可展开但没内容的箭头
  const prune = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((node) => {
      if (!node.children?.length) return { value: node.value, label: node.label };
      return { ...node, children: prune(node.children) };
    });

  return prune(roots);
}

/** 层级选项统一成「名称 / 值」：字符串按选项行解析，数组直接取 label / value */
function toPathItems(raw: unknown): OptionItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return { label: String(obj.label ?? obj.value ?? ""), value: String(obj.value ?? "") };
        }
        return { label: String(item ?? ""), value: "" };
      })
      .filter((item) => item.label !== "");
  }
  if (typeof raw !== "string") return [];
  return parseOptionLines(raw);
}

/** `a,b,c` → ["a","b","c"]，给多选类选项用；与 parseLabels 同义，保留语义化别名 */
export function parseList(raw: unknown): string[] {
  return parseLabels(raw);
}
