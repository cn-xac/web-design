<script setup lang="ts">
/**
 * 逻辑面板：高级计算、显示隐藏、渲染条件、循环数据。
 *
 * 这四项都是「节点的行为 / 数据逻辑」，与间距、颜色等纯视觉样式无关，
 * 从样式面板独立出来，让属性面板的职责保持单一。
 * 数据模型与求值仍在 core，这里只放编辑入口与说明。
 */
import { computed } from "vue";
import { CONDITION_MODE_OPTIONS, canOwnCalculation } from "@x-ac/web-design-core";
import { useDesignerStore } from "../store";
import { useCalculationDialog, useConditionDialog } from "../dialogs";
import UiControl from "../ui/UiControl.vue";

const store = useDesignerStore();
const node = computed(() => store.selectedNode);
const conditionDialog = useConditionDialog();
const calculationDialog = useCalculationDialog();

/** 仅文字 / 数字元素可配置数据计算（rtHicl） */
const canCalculate = computed(() => (node.value ? canOwnCalculation(node.value) : false));
const calculationSummary = computed(() => {
  const config = node.value?.calculation;
  return config ? `${config.operands.length} 个元素 · ${config.formula}` : "未配置";
});

function openCalculation(): void {
  if (!node.value || !canCalculate.value) return;
  calculationDialog.open({
    nodeId: node.value.id,
    label: String(node.value.props?.label ?? node.value.component),
  });
}

function conditionSummary(): string {
  const group = node.value?.visibility?.when;
  if (!group?.rows.length) return "未配置";
  const mode = CONDITION_MODE_OPTIONS.find((option) => option.value === group.mode)?.label ?? group.mode;
  const action = node.value?.visibility?.action ?? "show";
  return `${group.rows.length} 条 · ${mode} · ${action === "hide" ? "命中隐藏" : "命中显示"}`;
}

function openConditions(): void {
  if (!node.value) return;
  conditionDialog.open({
    nodeId: node.value.id,
    label: String(node.value.props?.label ?? node.value.component),
  });
}

const DIRECTIVES: Array<{ name: "show" | "if" | "for"; label: string; tip: string; placeholder: string }> = [
  { name: "show", label: "显示条件", tip: "不满足时渲染但隐藏，如 list.length > 0", placeholder: "list.length > 0" },
  { name: "if", label: "渲染条件", tip: "不满足时完全不渲染，适合有明显副作用的组件", placeholder: "form.type === 'a'" },
  { name: "for", label: "循环数据", tip: "绑定数组，子组件内用 item / index 访问", placeholder: "{{list}}" },
];

function directiveValue(name: "show" | "if" | "for"): string {
  return node.value?.directives?.find((item) => item.name === name)?.value ?? "";
}
</script>

<template>
  <div v-if="node" class="logic">
    <div class="style__section">高级计算（数据计算）</div>
    <div class="style__row style__row--block">
      <label>高级计算</label>
      <button
        type="button"
        class="style__cond-btn style__calc-btn"
        :disabled="!canCalculate"
        @click="openCalculation"
      >
        {{ calculationSummary }} · 配置高级计算
      </button>
      <div class="style__tip">
        {{ canCalculate ? "结果自动填入当前元素；支持高级函数与子表单聚合" : "仅文字 / 数字元素可配置高级计算" }}
      </div>
    </div>

    <div class="style__section">显示 / 隐藏条件</div>
    <div class="style__row style__row--block">
      <label>条件显隐</label>
      <button type="button" class="style__cond-btn" @click="openConditions()">
        {{ conditionSummary() }} · 配置
      </button>
      <div class="style__tip">一组条件 + 命中动作，未命中取反，无中间态</div>
    </div>

    <div class="style__section">显示与循环（旧指令）</div>
    <div v-for="directive in DIRECTIVES" :key="directive.name" class="style__row style__row--block">
      <label>{{ directive.label }}</label>
      <UiControl
        as="Input"
        size="small"
        :model-value="directiveValue(directive.name)"
        :placeholder="directive.placeholder"
        @update:model-value="(v: string) => store.setDirective(directive.name, v)"
      />
      <div class="style__tip">{{ directive.tip }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 与 StyleEditor 保持一致的观感（Vue scoped 样式不跨组件，故在此复刻一份） */
.logic {
  padding: 14px;
}
.style__cond-btn {
  width: 100%;
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  color: var(--wb-ink2);
  cursor: pointer;
}
.style__cond-btn:hover {
  border-color: var(--wb-primary);
  color: var(--wb-primary);
}
.style__cond-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.style__section {
  margin: 16px 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--wb-ink3);
}
.style__section:first-child {
  margin-top: 0;
}
.style__row {
  display: grid;
  grid-template-columns: 64px 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.style__row--block {
  grid-template-columns: 64px 1fr;
  align-items: start;
}
.style__row label {
  font-size: 12px;
  color: var(--wb-ink2);
}
.style__tip {
  grid-column: 2;
  font-size: 11px;
  color: var(--wb-ink3);
  line-height: 1.5;
  margin-top: -4px;
}
</style>
