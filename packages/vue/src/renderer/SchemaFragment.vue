<script setup lang="ts">
/**
 * 内嵌页面渲染：把一份 schema（PageSchema 或节点数组）渲染成页面。
 *
 * 与 SchemaRenderer 的区别：
 * - SchemaRenderer 是「页面入口」，自己构造 scope、跑页面级数据源；
 * - SchemaFragment 是「页面片段」，**共用宿主 scope**，只递归渲染 children，
 *   不去执行内嵌 schema 自己的 state / dataSource（避免作用域二次构造）。
 *
 * 用途：标签页的页签内容由绑定数据或外部 URL 提供，运行时按 schema 协议解析成页面。
 */
import { computed } from "vue";
import type { NodeSchema, PageSchema } from "@x-ac/web-design-core";
import SchemaNode from "./SchemaNode.vue";

const props = withDefaults(
  defineProps<{
    /** 内嵌内容：页面 schema、节点数组，或它们的 JSON 字符串 */
    page?: PageSchema | NodeSchema[] | string | null;
    /** 宿主 scope：内嵌页与宿主共用同一份数据作用域 */
    scope: Record<string, unknown>;
    mode?: "view" | "edit";
    design?: boolean;
    emptyText?: string;
  }>(),
  { page: null, mode: "view", design: false, emptyText: "" },
);

/** 归一成节点数组：字符串先当 JSON 解析，脏数据一律降级为空，绝不白屏 */
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

const nodes = computed(() => toNodes(props.page));
</script>

<template>
  <div class="wb-fragment">
    <SchemaNode
      v-for="node in nodes"
      :key="node.id"
      :node="node"
      :scope="scope"
      :mode="mode"
      :design="design"
    />
    <div v-if="!nodes.length && emptyText" class="wb-fragment__empty">{{ emptyText }}</div>
  </div>
</template>

<style scoped>
.wb-fragment {
  display: block;
  min-width: 0;
}
.wb-fragment__empty {
  padding: 8px 0;
  font-size: 12px;
  color: var(--wb-ink3, #8b93a5);
}
</style>
