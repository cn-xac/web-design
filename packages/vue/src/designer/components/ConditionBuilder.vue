<script setup lang="ts">
/**
 * 通用多条件构造器弹窗（rfD7Jv），供「元素的显示和隐藏逻辑优化」(r5u4Ul) 调用。
 *
 * 数据模型与求值全部在 core，本组件只负责编辑 UI：
 * - 每行一个条件：序号 + 左元素 + 关系 + 右值；特殊场景可勾选「仅值」；
 * - 右值控件由左元素类型决定（core 统一判定）：选项类直接选该元素的选项，
 *   开关选真/假，数字/日期用对应输入，文本类才用文本框；
 * - 条件间：并且 / 或者 / 高级（按序号组合，如 1 and (2 or 3)）；
 * - 子表单内元素只能选同一子表单内的字段（core 的清单已裁剪）；
 * - 子表单外引用明细字段时显示聚合口径，缺省求和。
 *
 * 与适配包解耦：控件用原生 select / input，CI stub 环境也能真实点击测试。
 */
import { computed, ref, watch } from "vue";
import {
  CONDITION_AGGREGATES,
  CONDITION_MODE_OPTIONS,
  CONDITION_OPERATOR_OPTIONS,
  VISIBILITY_ACTIONS,
  collectConditionElements,
  findLocation,
  resolveConditionOperatorsByPath,
  resolveConditionValueControlByPath,
  validateAdvancedExpression,
  type ConditionGroup,
  type ConditionMode,
  type ConditionRow,
  type VisibilityAction,
  type VisibilityConfig,
} from "@x-ac/web-design-core";
import { useDesignerStore } from "../store";
import { useConditionDialog } from "../dialogs";
import { useNotify } from "../ui/kit";
import ModalShell from "../ui/ModalShell.vue";
import UiControl from "../ui/UiControl.vue";

interface DraftRow extends ConditionRow {
  /** 仅 UI 状态：勾选后该行只有 value，不落库 */
  valueOnly?: boolean;
}

interface Draft extends Omit<ConditionGroup, "rows"> {
  rows: DraftRow[];
}

const store = useDesignerStore();
const dialog = useConditionDialog();
const notify = useNotify();

function blankRow(): DraftRow {
  return { left: "", operator: "eq", value: "", aggregate: "sum" };
}

const draft = ref<Draft>({ mode: "and", rows: [blankRow()], expression: "" });
const action = ref<VisibilityAction>("show");

const elements = computed(() =>
  collectConditionElements(store.page, { nodeId: dialog.target.value?.nodeId }),
);

const title = computed(() => "配置显示 / 隐藏条件");

const expressionError = computed(() => {
  if (draft.value.mode !== "advanced") return "";
  return validateAdvancedExpression(draft.value.expression ?? "", draft.value.rows.length) ?? "";
});

const scopeTip = computed(() => {
  const target = dialog.target.value;
  if (!target) return "";
  return elements.value.some((element) => element.inSubform)
    ? "可选元素已按所在子表单裁剪；引用明细字段时需指定聚合口径。"
    : "可选元素来自当前页面；引用子表单明细字段时需指定聚合口径。";
});

watch(
  () => [dialog.visible.value, dialog.target.value?.nodeId] as const,
  ([visible]) => {
    if (visible) load();
  },
  { immediate: true },
);

function load(): void {
  const target = dialog.target.value;
  const visibility = target
    ? findLocation(store.page.children, target.nodeId)?.node?.visibility
    : undefined;
  const group = visibility?.when;
  action.value = visibility?.action ?? "show";
  if (group) {
    draft.value = {
      mode: group.mode,
      expression: group.expression ?? "",
      rows: group.rows.map((row) => ({
        ...JSON.parse(JSON.stringify(row)),
        aggregate: row.aggregate ?? "sum",
        valueOnly: !row.left && !row.operator,
      })),
    };
  } else {
    draft.value = { mode: "and", rows: [blankRow()], expression: "" };
  }
}

function requiresAggregate(left: string | undefined): boolean {
  return elements.value.find((element) => element.path === left)?.requiresAggregate ?? false;
}

function isUnary(operator: ConditionRow["operator"]): boolean {
  return CONDITION_OPERATOR_OPTIONS.find((option) => option.value === operator)?.unary ?? false;
}

/** 右值控件与关系候选完全由 core 判定，本组件只按描述渲染，不自带类型映射表 */
function controlOf(row: DraftRow) {
  return resolveConditionValueControlByPath(store.page, elements.value, row.left, row.operator, row.value);
}

function operatorsOf(row: DraftRow) {
  return resolveConditionOperatorsByPath(store.page, elements.value, row.left, row.operator);
}

/** 切换左元素时清空旧值；旧关系若不适用于新元素类型，回退到候选首项 */
function onLeftChange(row: DraftRow, left: string): void {
  row.left = left;
  row.value = "";
  // 不传当前关系：兼容项只用于载入旧配置，主动切换左元素必须回退到纯候选
  const allowed = resolveConditionOperatorsByPath(store.page, elements.value, left);
  if (!allowed.some((option) => option.value === row.operator)) {
    row.operator = allowed[0]?.value ?? "eq";
  }
}

/** 右侧下拉选值：core 把选项 value 定为落库值，直接写入即可 */
function onValueChange(row: DraftRow, value: string): void {
  row.value = value;
}

/** UiControl 的 Select 要求 options 形态为 { label, value } */
const leftOptions = computed(() =>
  elements.value.map((element) => ({
    label: `${element.label}（${element.path}）`,
    value: element.path,
  })),
);
const aggregateOptions = computed(() =>
  CONDITION_AGGREGATES.map((option) => ({ label: option.label, value: option.value })),
);

function addRow(): void {
  draft.value.rows.push(blankRow());
}

function removeRow(index: number): void {
  draft.value.rows.splice(index, 1);
}

function toggleValueOnly(row: DraftRow): void {
  row.valueOnly = !row.valueOnly;
  if (row.valueOnly) {
    row.left = undefined;
    row.operator = undefined;
    row.aggregate = undefined;
  } else {
    row.left = "";
    row.operator = "eq";
  }
}

function cleanRows(rows: DraftRow[]): ConditionRow[] {
  return rows
    .filter((row) =>
      row.valueOnly ? String(row.value ?? "").trim() !== "" : Boolean(row.left && row.operator),
    )
    .map((row) => {
      if (row.valueOnly) return { value: row.value };
      const out: ConditionRow = { left: row.left, operator: row.operator };
      if (row.aggregate && requiresAggregate(row.left)) out.aggregate = row.aggregate;
      if (!isUnary(row.operator)) out.value = row.value;
      return out;
    });
}

function save(): void {
  const target = dialog.target.value;
  if (!target) return;
  if (expressionError.value) {
    notify(expressionError.value, "error");
    return;
  }

  const rows = cleanRows(draft.value.rows);
  if (!rows.length) {
    store.setVisibility(undefined);
  } else {
    const next: VisibilityConfig = {
      when: {
        mode: draft.value.mode,
        rows,
        ...(draft.value.mode === "advanced" && draft.value.expression
          ? { expression: draft.value.expression.trim() }
          : {}),
      },
      action: action.value,
    };
    store.setVisibility(next);
  }
  dialog.close();
  notify("显示隐藏条件已更新", "success");
}

function clear(): void {
  draft.value = { mode: "and", rows: [blankRow()], expression: "" };
  action.value = "show";
}

function setMode(mode: ConditionMode): void {
  draft.value.mode = mode;
  if (mode === "advanced" && !draft.value.expression) {
    draft.value.expression = draft.value.rows.map((_, index) => index + 1).join(" and ");
  }
}
</script>

<template>
  <ModalShell
    v-if="dialog.visible.value && dialog.target.value"
    :title="title"
    width="680px"
    @close="dialog.close()"
  >
    <div class="cond__hint">
      条件命中执行下方「命中时动作」，未命中则执行相反动作——始终有明确结果，无中间态。
      <br />{{ scopeTip }}
    </div>

    <div class="cond__section">命中时动作</div>
    <div class="cond__modes">
      <UiControl
        v-for="option in VISIBILITY_ACTIONS"
        :key="option.value"
        as="Button"
        class="cond__mode"
        :class="{ 'is-active': action === option.value }"
        :title="option.hint"
        @click="action = option.value"
      >
        {{ option.label }}
      </UiControl>
    </div>

    <div class="cond__section">条件间关系</div>
    <div class="cond__modes">
      <UiControl
        v-for="option in CONDITION_MODE_OPTIONS"
        :key="option.value"
        as="Button"
        class="cond__mode"
        :class="{ 'is-active': draft.mode === option.value }"
        @click="setMode(option.value)"
      >
        {{ option.label }}
      </UiControl>
    </div>

    <div v-if="draft.mode === 'advanced'" class="cond__advanced">
      <UiControl
        as="Input"
        v-model="draft.expression"
        class="cond__expression wb-mono"
        type="text"
        spellcheck="false"
        placeholder="1 and (2 or 3)"
      />
      <div class="cond__tip" :class="{ 'is-error': expressionError }">
        {{ expressionError || "用条件序号组合，支持 and / or / not 与括号，序号从 1 开始。" }}
      </div>
    </div>

    <div class="cond__section">条件列表</div>
    <div class="cond__rows wb-scroll">
      <div v-for="(row, index) in draft.rows" :key="index" class="cond__row">
        <span class="cond__no">{{ index + 1 }}</span>

        <template v-if="!row.valueOnly">
          <UiControl
            as="Select"
            :model-value="row.left ?? ''"
            :options="leftOptions"
            placeholder="选择元素"
            class="cond__select cond__left"
            aria-label="左元素"
            @update:model-value="(left: string) => onLeftChange(row, left)"
          />

          <UiControl
            v-if="requiresAggregate(row.left)"
            as="Select"
            v-model="row.aggregate"
            :options="aggregateOptions"
            class="cond__select cond__aggregate"
            aria-label="聚合口径"
          />

          <UiControl
            as="Select"
            v-model="row.operator"
            :options="operatorsOf(row)"
            class="cond__select cond__operator"
            aria-label="关系"
          />

          <template v-if="controlOf(row).kind !== 'none'">
            <UiControl
              v-if="controlOf(row).kind === 'options' || controlOf(row).kind === 'boolean'"
              as="Select"
              :model-value="String(row.value ?? '')"
              :options="controlOf(row).options"
              placeholder="请选择"
              class="cond__select cond__value cond__value-select"
              aria-label="右侧值"
              @update:model-value="(value: string) => onValueChange(row, value)"
            />
            <UiControl
              v-else
              as="Input"
              v-model="row.value"
              class="cond__value"
              :type="controlOf(row).inputType ?? 'text'"
              aria-label="右侧值"
              :placeholder="controlOf(row).kind === 'legacy' ? '旧值，请重新选择' : '请输入值'"
              :title="controlOf(row).hint"
            />
          </template>
          <span v-else class="cond__value-placeholder">—</span>
        </template>

        <UiControl
          v-else
          as="Input"
          v-model="row.value"
          class="cond__value cond__value--only"
          type="text"
          placeholder="仅值：表达式或字面量，如 &#123;&#123;form.amount&#125;&#125; > 10"
        />

        <label class="cond__only" title="特殊场景：只填值，不设左元素与关系">
          <UiControl as="Switch" :model-value="Boolean(row.valueOnly)" @update:model-value="toggleValueOnly(row)" />仅值
        </label>
        <UiControl as="Button" class="cond__del" aria-label="删除条件" @click="removeRow(index)">×</UiControl>
      </div>
      <div v-if="!draft.rows.length" class="cond__empty">还没有条件，点击「添加条件」开始</div>
    </div>

    <UiControl as="Button" class="cond__add" @click="addRow">＋ 添加条件</UiControl>

    <template #footer>
      <UiControl as="Button" class="cond__clear" @click="clear">清空</UiControl>
      <span class="cond__spacer" />
      <UiControl as="Button" class="cond__cancel" @click="dialog.close()">取消</UiControl>
      <UiControl as="Button" type="primary" class="cond__ok" @click="save">确定</UiControl>
    </template>
  </ModalShell>
</template>

<style scoped>
.cond__hint {
  margin-bottom: 12px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--wb-ink2);
}
.cond__section {
  margin: 14px 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--wb-ink3);
}
.cond__modes {
  display: flex;
  gap: 6px;
}
.cond__mode {
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 14px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink2);
  cursor: pointer;
}
.cond__mode.is-active {
  border-color: var(--wb-primary);
  background: var(--wb-primary-soft);
  color: var(--wb-primary);
}
.cond__advanced {
  margin-top: 8px;
}
.cond__expression {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--wb-line);
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--wb-ink);
}
.cond__tip {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--wb-ink3);
}
.cond__tip.is-error {
  color: var(--wb-danger);
}
.cond__rows {
  max-height: 260px;
  border: 1px solid var(--wb-line-soft);
  border-radius: 8px;
  background: #fbfcfe;
}
.cond__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--wb-line-soft);
  flex-wrap: wrap;
}
.cond__no {
  width: 20px;
  flex: none;
  text-align: center;
  font-size: 12px;
  color: var(--wb-ink3);
}
.cond__select:where(input,select,textarea),
.cond__value:where(input,select,textarea){
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 7px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink);
  min-width: 0;
}
.cond__left {
  flex: 1 1 150px;
}
.cond__aggregate {
  flex: 0 0 78px;
}
.cond__operator {
  flex: 0 0 88px;
}
.cond__value {
  flex: 1 1 110px;
}
.cond__value--only {
  flex: 1 1 320px;
}
.cond__value-placeholder {
  flex: 1 1 110px;
  color: var(--wb-ink3);
}
.cond__only {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: none;
  font-size: 11px;
  color: var(--wb-ink2);
  cursor: pointer;
}
.cond__del {
  flex: none;
  border: none;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  color: var(--wb-ink3);
  cursor: pointer;
}
.cond__del:hover {
  color: var(--wb-danger);
}
.cond__empty {
  padding: 18px;
  text-align: center;
  font-size: 12px;
  color: var(--wb-ink3);
}
.cond__add {
  margin-top: 8px;
  border: 1px dashed var(--wb-line);
  border-radius: 6px;
  background: #fff;
  padding: 6px 12px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink2);
  cursor: pointer;
}
.cond__clear,
.cond__cancel,
.cond__ok {
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.cond__clear,
.cond__cancel {
  border: 1px solid var(--wb-line);
  background: #fff;
  color: var(--wb-ink2);
}
.cond__ok {
  border: 1px solid var(--wb-primary);
  background: var(--wb-primary);
  color: #fff;
}
.cond__spacer {
  flex: 1;
}
</style>
