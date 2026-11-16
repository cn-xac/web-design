/**
 * 标签页 pane 容器同步（rGjzDs）。
 *
 * 每个 content:"design" 的标签项对应 tabs 节点下的一个 ec-container 子节点，
 * 容器 props.paneId 指回 TabItem.id。页签增删改序时按 id 对齐容器，
 * 保证「删页签连带子树隔离」「重排不串页签」。
 *
 * 纯函数：只改传入的 tabs 节点，不碰其它节点；调用方负责包进 mutatePage 以获得撤销记录。
 */

import type { TabItem } from "../materials/parse";
import type { NodeSchema } from "./types";
import { createNodeId } from "./tree";

const PANE_COMPONENT = "ec-container";

/** 取一个节点的 paneId（只有容器子节点的 props.paneId 才算） */
export function paneIdOf(node: NodeSchema): string | null {
  if (node.component !== PANE_COMPONENT) return null;
  const value = node.props?.paneId;
  return typeof value === "string" && value ? value : null;
}

/** 找出 tabs 节点下所有 pane 容器 */
export function paneContainersOf(tabs: NodeSchema): NodeSchema[] {
  return (tabs.children ?? []).filter((node) => paneIdOf(node) !== null);
}

/** 按 paneId 找对应容器 */
export function paneContainerOf(tabs: NodeSchema, paneId: string): NodeSchema | null {
  return paneContainersOf(tabs).find((node) => paneIdOf(node) === paneId) ?? null;
}

/**
 * 同步 tabs 的 pane 容器，使之一一对应 items 中 content:"design" 的项。
 *
 * - 已存在同 paneId 的容器：原样复用（保留其 children 与全部属性）；
 * - 新 design 项：新建空容器；
 * - 被删除 / 改成非 design 的项：连同容器子树一起移除（隔离，不迁移到别处）；
 * - 非 pane 子节点（历史脏数据）：原样保留在数组末尾，不擅自删除。
 *
 * @returns 是否发生变更
 */
export function syncTabPanes(tabs: NodeSchema, items: TabItem[]): boolean {
  const designItems = items.filter((item) => item.content === "design" || item.content === undefined);
  const wanted = new Set(designItems.map((item) => item.id));
  const children = tabs.children ?? [];
  const existing = new Map<string, NodeSchema>();
  const others: NodeSchema[] = [];

  for (const node of children) {
    const id = paneIdOf(node);
    if (!id) {
      others.push(node);
      continue;
    }
    // 重复 paneId：保留第一个，其余当脏数据丢弃（连同子树）
    if (existing.has(id) || !wanted.has(id)) continue;
    existing.set(id, node);
  }

  const next: NodeSchema[] = designItems.map((item) => {
    const found = existing.get(item.id);
    if (found) return found;
    return {
      id: createNodeId("pane"),
      component: PANE_COMPONENT,
      props: { paneId: item.id },
      children: [],
    };
  });
  next.push(...others);

  if (samePaneOrder(children, next)) return false;
  tabs.children = next;
  return true;
}

/** 比较引用顺序，避免无谓重渲染 / 撤销记录 */
function samePaneOrder(a: NodeSchema[], b: NodeSchema[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((node, index) => node === b[index]);
}

/**
 * 旧页面迁移：把 content:"text" 的页签正文转成文本节点塞进 pane 容器。
 * 只在设计器首次打开 / 显式迁移时调用，运行时不自动改 Schema。
 */
export function migrateTextPanes(tabs: NodeSchema, items: TabItem[]): boolean {
  let changed = false;
  for (const item of items) {
    // text 来源直接匹配；也兼容调用方已把 text 升级成 design 的情况（此时 text 字段仍在）
    if (!item.text) continue;
    if (item.content !== "text" && item.content !== "design") continue;
    const container = paneContainerOf(tabs, item.id);
    if (!container) continue;
    if (container.children?.length) continue; // 已有设计节点，不覆盖
    container.children = [
      {
        id: createNodeId("txt"),
        component: "ec-text",
        props: { text: item.text },
      },
    ];
    changed = true;
  }
  return changed;
}
