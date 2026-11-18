/**
 * 数据计算的设计期 / 运行期清单。
 *
 * 路径规则与 `collectBindableElements` 严格同源：
 * - 显式 `props.modelValue = "{{path}}"` 优先；
 * - 否则落在当前绑定前缀下（`form.<节点ID>`）；
 * - 子表单内前缀为 `form.<itemPath>[0]`，`[0]` 是设计期行占位。
 *
 * 与 `collectConditionElements` 的区别：那里只收表单控件与明细容器（参与元素），
 * 这里收的是「带计算配置的目标节点」，文字类展示元素也算。
 */

import { extractPath } from "../schema/expression";
import { canOwnExternalSource } from "../data/bindable";
import { MATERIALS } from "../materials/catalog";
import { createRegistry, type MaterialRegistry } from "../materials/registry";
import type { NodeSchema, PageSchema } from "../schema/types";
import type { CalculationTarget } from "./types";

/** 文字 / 数字类元素：只有这些元素能「添加高级计算」 */
const CALCULABLE_KEYS = new Set([
  "text",
  "title",
  "paragraph",
  "tag",
  "statistic",
  "number",
  "input",
  "input-number",
  "inputnumber",
]);

function bareKey(component: string): string {
  return component.replace(/^ec-/, "").toLowerCase();
}

export interface CanCalculateOptions {
  registry?: MaterialRegistry;
}

/**
 * 目标元素资格判定：能被计算结果回填的元素。
 *
 * 口径（与 canOwnExternalSource 同源，避免清单漂移）：
 * - 文字 / 数字类展示元素（text/title/statistic/input 等）；
 * - 表单控件（含数字输入框等），以及选项类物料（select/radio/checkbox 等）：
 *   这些元素的值本身就是可自定义/可写的，计算结果回填到它的值路径即可；
 * - 未知物料退化为按组件名判定，不因缺元数据而全禁。
 */
export function canOwnCalculation(node: NodeSchema, options: CanCalculateOptions = {}): boolean {
  const registry = options.registry ?? createRegistry(MATERIALS);
  const material = registry.get(node.component);
  if (material?.textProp) return true;
  // 表单控件 + 选项类物料：值可写，能承载计算结果
  if (canOwnExternalSource(node.component, registry)) return true;
  const key = bareKey(node.component);
  if (CALCULABLE_KEYS.has(key)) return true;
  return key.includes("number") || key.includes("statistic");
}

export interface CollectCalculationTargetsOptions {
  registry?: MaterialRegistry;
}

/** 遍历页面树，找出所有配了 `calculation` 的节点及其回填路径 */
export function collectCalculationTargets(
  page: PageSchema,
  options: CollectCalculationTargetsOptions = {},
): CalculationTarget[] {
  const registry = options.registry ?? createRegistry(MATERIALS);
  const out: CalculationTarget[] = [];

  const walk = (nodes: NodeSchema[] | undefined, base: string): void => {
    for (const node of nodes ?? []) {
      const material = registry.get(node.component);
      const explicit = extractPath(node.props?.modelValue);
      const path = explicit ?? `${base}.${node.id}`;

      if (node.calculation) {
        out.push({
          nodeId: node.id,
          path,
          label: String(node.props?.label ?? material?.title ?? node.component),
          config: node.calculation,
          displayProp: material?.textProp,
        });
      }

      if (material?.kind === "subform") {
        const itemPath = String(node.props?.itemPath ?? "items");
        walk(node.children ?? [], itemPath ? `${base}.${itemPath}[0]` : base);
      } else {
        walk(node.children ?? [], base);
      }
    }
  };

  walk(page.children ?? [], "form");
  return out;
}
