/**
 * 内嵌页面渲染（React 版，对齐 Vue 的 SchemaFragment）。
 *
 * 把一份 schema（PageSchema 或节点数组）渲染成页面，**共用宿主 scope**：
 * 通过 RenderContext 覆盖 mode / design，子树仍读同一份 scope，
 * 不重新构造页面级状态，也不执行内嵌 schema 自己的 dataSource。
 *
 * 用途：标签页的页签内容由绑定数据或外部 URL 提供，运行时按 schema 协议解析成页面。
 */
import { createElement } from "react";
import type { NodeSchema, PageSchema } from "@x-ac/web-design-core";
import { RenderContext, useRenderContext } from "./context";
import type { RenderMode } from "./context";
import { SchemaNode } from "./SchemaNode";

export interface SchemaFragmentProps {
  /** 内嵌内容：页面 schema、节点数组，或它们的 JSON 字符串 */
  page?: PageSchema | NodeSchema[] | string | null;
  /** 覆盖渲染模式；不传则沿用宿主上下文 */
  mode?: RenderMode;
  /** 覆盖设计态；不传则沿用宿主上下文 */
  design?: boolean;
  emptyText?: string;
}

/** 归一成节点数组：字符串先当 JSON 解析，脏数据降级为空，绝不白屏 */
function toNodes(value: PageSchema | NodeSchema[] | string | null | undefined): NodeSchema[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return toNodes(JSON.parse(value) as PageSchema | NodeSchema[]);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return (value as PageSchema).children ?? [];
  return [];
}

export function SchemaFragment({ page, mode, design, emptyText }: SchemaFragmentProps) {
  const ctx = useRenderContext();
  const nodes = toNodes(page);

  // 只覆盖 mode / design，scope / page / 校验上下文全部沿用宿主
  const value = { ...ctx };
  if (mode !== undefined) value.mode = mode;
  if (design !== undefined) value.design = design;

  return createElement(
    RenderContext.Provider,
    { value },
    nodes.length
      ? nodes.map((node) => createElement(SchemaNode, { key: node.id, node }))
      : emptyText
        ? createElement("div", { className: "ux-fragment__empty" }, emptyText)
        : null,
  );
}
