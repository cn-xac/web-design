<script setup lang="ts">
/**
 * 数据计算弹窗（@todo rtHicl）。
 *
 * 编辑的全部是纯数据：参与元素（路径 + 别名 + 聚合口径）、算式、参与条件、
 * 输出口径；求值由 core 的 `evaluateCalculation` / `applyCalculations` 承担，
 * 引擎这里不实现任何计算逻辑，也不把函数实现写进 Schema。
 *
 * 「参与条件」复用 rfD7Jv 的 `ConditionGroup` 契约与 `evaluateConditionGroup` 求值，
 * 因此后续把通用多条件组件抽成受控组件时可以零成本替换这段内联编辑器。
 */
import { computed, nextTick, ref, watch } from "vue";
import {
  CALCULATION_AGGREGATES,
  CALCULATION_ALIASES,
  CONDITION_MODE_OPTIONS,
  CONDITION_OPERATOR_OPTIONS,
  calculationFunctionGroups,
  collectCalculationTargets,
  collectConditionElements,
  evaluateCalculation,
  findLocation,
  setByPath,
  validateCalculationConfig,
  validateCalculationFormula,
  type CalculationConfig,
  type CalculationFunction,
  type CalculationOperand,
  type CalculationOutput,
  type ConditionAggregate,
  type ConditionMode,
  type ConditionOperator,
  type ConditionRow,
  type Scope,
} from "@x-ac/web-design-core";
import { useDesignerStore } from "../store";
import { useCalculationDialog } from "../dialogs";
import { useNotify } from "../ui/kit";
import ModalShell from "../ui/ModalShell.vue";
import CalculationHelpDialog from "./CalculationHelpDialog.vue";

interface DraftOperand {
  path: string;
  alias: string;
  aggregate: ConditionAggregate;
}

interface DraftConditionRow {
  left: string;
  operator: ConditionOperator;
  value: string;
  aggregate: ConditionAggregate;
}

const store = useDesignerStore();
const dialog = useCalculationDialog();
const notify = useNotify();
const formulaEl = ref<HTMLTextAreaElement | null>(null);
/** 当前查看说明的函数；悬停 / 聚焦时切换，点击按钮仍只负责插入签名 */
const activeFn = ref<CalculationFunction | null>(null);
/** 完整使用说明（内容较长，单独一层弹窗承载） */
const helpVisible = ref(false);

const draft = ref({
  operands: [] as DraftOperand[],
  formula: "",
  precision: "" as string,
  emptyAsZero: false,
  output: "number" as CalculationOutput,
  whenEnabled: false,
  whenMode: "and" as ConditionMode,
  whenRows: [] as DraftConditionRow[],
});

const nodeId = computed(() => dialog.target.value?.nodeId ?? "");
const elements = computed(() => collectConditionElements(store.page, { nodeId: nodeId.value }));
const targetPath = computed(
  () => collectCalculationTargets(store.page).find((item) => item.nodeId === nodeId.value)?.path ?? "",
);
const functionGroups = calculationFunctionGroups();
const modeOptions = CONDITION_MODE_OPTIONS.filter((option) => option.value !== "advanced");

watch(
  () => [dialog.visible.value, nodeId.value] as const,
  ([visible]) => {
    if (visible) load();
  },
  { immediate: true },
);

function requiresAggregate(path: string): boolean {
  return elements.value.find((element) => element.path === path)?.requiresAggregate ?? false;
}

function labelOf(path: string): string {
  return elements.value.find((element) => element.path === path)?.label ?? path;
}

function isUnary(operator: ConditionOperator): boolean {
  return CONDITION_OPERATOR_OPTIONS.find((option) => option.value === operator)?.unary ?? false;
}

function blankOperand(): DraftOperand {
  return { path: "", alias: CALCULATION_ALIASES[draft.value.operands.length] ?? `V${draft.value.operands.length + 1}`, aggregate: "sum" };
}

function blankConditionRow(): DraftConditionRow {
  return { left: "", operator: "eq", value: "", aggregate: "sum" };
}

function load(): void {
  const config = findLocation(store.page.children, nodeId.value)?.node?.calculation;
  if (!config) {
    draft.value = {
      operands: [blankOperand()],
      formula: "",
      precision: "",
      emptyAsZero: false,
      output: "number",
      whenEnabled: false,
      whenMode: "and",
      whenRows: [],
    };
    return;
  }
  draft.value = {
    operands: config.operands.length
      ? config.operands.map((operand) => ({
          path: operand.path,
          alias: operand.alias,
          aggregate: operand.aggregate ?? "sum",
        }))
      : [blankOperand()],
    formula: config.formula,
    precision: config.precision === undefined ? "" : String(config.precision),
    emptyAsZero: Boolean(config.emptyAsZero),
    output: config.output ?? "number",
    whenEnabled: Boolean(config.when?.rows.length),
    whenMode: config.when?.mode === "or" ? "or" : "and",
    whenRows: (config.when?.rows ?? []).map((row) => ({
      left: row.left ?? "",
      operator: row.operator ?? "eq",
      value: row.value === undefined || row.value === null ? "" : String(row.value),
      aggregate: row.aggregate ?? "sum",
    })),
  };
}

function buildConfig(): CalculationConfig | null {
  const operands: CalculationOperand[] = draft.value.operands
    .filter((operand) => operand.path && operand.alias.trim())
    .map((operand) => ({
      path: operand.path,
      alias: operand.alias.trim(),
      label: labelOf(operand.path),
      ...(requiresAggregate(operand.path) ? { aggregate: operand.aggregate } : {}),
    }));
  if (!operands.length) return null;

  const whenRows: ConditionRow[] = draft.value.whenEnabled
    ? draft.value.whenRows
        .filter((row) => row.left && row.operator)
        .map((row) => ({
          left: row.left,
          operator: row.operator,
          ...(requiresAggregate(row.left) ? { aggregate: row.aggregate } : {}),
          ...(isUnary(row.operator) ? {} : { value: row.value }),
        }))
    : [];

  const precision =
    draft.value.precision.trim() === "" ? undefined : Number(draft.value.precision.trim());

  return {
    operands,
    formula: draft.value.formula.trim(),
    ...(Number.isFinite(precision) ? { precision } : {}),
    emptyAsZero: draft.value.emptyAsZero,
    output: draft.value.output,
    ...(whenRows.length
      ? { when: { mode: draft.value.whenMode, rows: whenRows } }
      : {}),
  };
}

const formulaError = computed(() => validateCalculationFormula(draft.value.formula));

const preview = computed(() => {
  if (formulaError.value) return "算式语法有误，暂不能试算";
  const config = buildConfig();
  if (!config) return "请先选择至少一个参与元素";
  const scope: Scope = JSON.parse(JSON.stringify(store.page.state ?? {})) as Scope;
  for (const operand of config.operands) setByPath(scope, operand.path, 1);
  const outcome = evaluateCalculation(config, scope, 0);
  return outcome.skipped
    ? `未参与计算：${outcome.reason ?? "条件未命中"}`
    : `试算结果：${String(outcome.value)}（每个参与元素按 1 代入）`;
});

function addOperand(): void {
  draft.value.operands.push(blankOperand());
}

function removeOperand(index: number): void {
  draft.value.operands.splice(index, 1);
}

function addConditionRow(): void {
  draft.value.whenRows.push(blankConditionRow());
}

function removeConditionRow(index: number): void {
  draft.value.whenRows.splice(index, 1);
}

/** 把函数签名插到光标处；没有焦点时追加到末尾 */
function insertFunction(signature: string): void {
  const element = formulaEl.value;
  const text = draft.value.formula;
  if (!element) {
    draft.value.formula = text.trim() ? `${text.trim()} + ${signature}` : signature;
    return;
  }
  const start = element.selectionStart ?? text.length;
  const end = element.selectionEnd ?? start;
  draft.value.formula = text.slice(0, start) + signature + text.slice(end);
  void nextTick(() => {
    element.focus();
    element.setSelectionRange(start + signature.length, start + signature.length);
  });
}

function save(): void {
  const target = dialog.target.value;
  if (!target) return;
  const config = buildConfig();
  if (!config) {
    notify("请至少选择一个参与元素", "error");
    return;
  }
  const errors = validateCalculationConfig(config, targetPath.value || undefined);
  if (errors.length) {
    notify(errors[0], "error");
    return;
  }
  store.setCalculation(config);
  dialog.close();
  notify("数据计算已更新", "success");
}

function clear(): void {
  store.setCalculation(undefined);
  dialog.close();
  notify("已移除数据计算配置", "success");
}
</script>

<template>
  <ModalShell
    v-if="dialog.visible.value && dialog.target.value"
    title="配置数据计算"
    width="760px"
    :esc-to-close="!helpVisible"
    @close="dialog.close()"
  >
    <div class="calc__hint">
      选择参与元素并写算式，运行时会自动算出结果并填入当前元素（回填路径：<span class="calc__path">{{ targetPath }}</span>）。
      <br />引用子表单明细字段时需指定聚合口径；算式只允许受限运算与下方白名单函数，不会执行任意代码。
    </div>

    <div class="calc__section">参与元素</div>
    <div class="calc__rows wb-scroll">
      <div v-for="(operand, index) in draft.operands" :key="index" class="calc__row">
        <span class="calc__no">{{ index + 1 }}</span>
        <select v-model="operand.path" class="calc__select calc__element" aria-label="参与元素">
          <option value="">选择元素</option>
          <option v-for="element in elements" :key="element.nodeId" :value="element.path">
            {{ element.label }}（{{ element.path }}）
          </option>
        </select>
        <select
          v-if="requiresAggregate(operand.path)"
          v-model="operand.aggregate"
          class="calc__select calc__aggregate"
          aria-label="聚合口径"
        >
          <option v-for="option in CALCULATION_AGGREGATES" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <input v-model="operand.alias" class="calc__alias" type="text" aria-label="算式变量名" placeholder="变量名 A" />
        <button type="button" class="calc__del" aria-label="删除参与元素" @click="removeOperand(index)">×</button>
      </div>
      <div v-if="!draft.operands.length" class="calc__empty">还没有参与元素</div>
    </div>
    <button type="button" class="calc__add" @click="addOperand">＋ 添加元素</button>

    <div class="calc__section">算式</div>
    <textarea
      ref="formulaEl"
      v-model="draft.formula"
      class="calc__formula wb-mono"
      rows="3"
      spellcheck="false"
      placeholder="例如：A * B，或 ROUND(SUM(A, B), 2)"
    />
    <div class="calc__tip" :class="{ 'is-error': formulaError }">
      {{ formulaError || "用变量名引用参与元素；支持 + - * / %、比较、三元与括号。" }}
    </div>

    <div class="calc__fn-title">
      <span class="calc__fn-label">高级函数（点击插入到光标处）</span>
      <button
        type="button"
        class="calc__help-btn"
        title="查看完整使用说明（通用规则 / 18 个函数 / 业务配方 / 排错）"
        aria-label="查看完整使用说明"
        @click="helpVisible = true"
      >?</button>
    </div>
    <div v-for="group in functionGroups" :key="group.group" class="calc__fn-group">
      <span class="calc__fn-group-name">{{ group.group }}</span>
      <button
        v-for="fn in group.items"
        :key="fn.name"
        type="button"
        class="calc__fn"
        :title="`${fn.signature} — ${fn.description}`"
        @mouseenter="activeFn = fn"
        @focus="activeFn = fn"
        @click="insertFunction(fn.signature)"
      >
        {{ fn.name }}
      </button>
    </div>
    <div v-if="activeFn" class="calc__fn-help">
      <div class="calc__fn-help-head">
        <code>{{ activeFn.signature }}</code>
        <span>{{ activeFn.label }} · {{ activeFn.group }}</span>
      </div>
      <div><b>参数</b> {{ activeFn.params }}</div>
      <div><b>返回</b> {{ activeFn.returns }}</div>
      <div><b>示例</b> <code>{{ activeFn.example }}</code></div>
      <div class="calc__fn-help-desc">{{ activeFn.description }}</div>
    </div>
    <div v-else class="calc__fn-help calc__fn-help--empty">
      悬停函数名查看单函数说明，点击函数插入签名；点右侧 ? 查看完整使用说明。
    </div>

    <div class="calc__section">输出设置</div>
    <div class="calc__options">
      <label class="calc__option">
        小数位
        <input v-model="draft.precision" class="calc__small" type="number" min="0" max="10" placeholder="原始精度" />
      </label>
      <label class="calc__option">
        输出形态
        <select v-model="draft.output" class="calc__select">
          <option value="number">数值</option>
          <option value="text">文本</option>
        </select>
      </label>
      <label class="calc__option">
        <input v-model="draft.emptyAsZero" type="checkbox" />空值按 0 参与
      </label>
    </div>

    <div class="calc__section">参与条件（复用多条件组件契约）</div>
    <label class="calc__option">
      <input v-model="draft.whenEnabled" type="checkbox" />仅当条件命中时才计算
    </label>
    <template v-if="draft.whenEnabled">
      <div class="calc__modes">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          class="calc__mode"
          :class="{ 'is-active': draft.whenMode === option.value }"
          @click="draft.whenMode = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="calc__rows">
        <div v-for="(row, index) in draft.whenRows" :key="index" class="calc__row">
          <select v-model="row.left" class="calc__select calc__element" aria-label="条件左元素">
            <option value="">选择元素</option>
            <option v-for="element in elements" :key="element.nodeId" :value="element.path">
              {{ element.label }}（{{ element.path }}）
            </option>
          </select>
          <select
            v-if="requiresAggregate(row.left)"
            v-model="row.aggregate"
            class="calc__select calc__aggregate"
            aria-label="条件聚合口径"
          >
            <option v-for="option in CALCULATION_AGGREGATES" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <select v-model="row.operator" class="calc__select calc__operator" aria-label="条件关系">
            <option v-for="option in CONDITION_OPERATOR_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <input v-if="!isUnary(row.operator)" v-model="row.value" class="calc__alias" type="text" placeholder="比较值" />
          <span v-else class="calc__placeholder">—</span>
          <button type="button" class="calc__del" aria-label="删除条件" @click="removeConditionRow(index)">×</button>
        </div>
        <div v-if="!draft.whenRows.length" class="calc__empty">还没有条件</div>
      </div>
      <button type="button" class="calc__add" @click="addConditionRow">＋ 添加条件</button>
    </template>

    <div class="calc__preview">{{ preview }}</div>

    <template #footer>
      <button type="button" class="calc__clear" @click="clear">移除计算</button>
      <span class="calc__spacer" />
      <button type="button" class="calc__cancel" @click="dialog.close()">取消</button>
      <button type="button" class="calc__ok" @click="save">确定</button>
    </template>
  </ModalShell>
  <CalculationHelpDialog v-if="helpVisible" @close="helpVisible = false" />
</template>

<style scoped>
.calc__hint {
  font-size: 12px;
  line-height: 1.8;
  color: var(--wb-ink2);
}
.calc__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--wb-primary);
}
.calc__section {
  margin: 14px 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--wb-ink3);
}
.calc__rows {
  max-height: 200px;
  border: 1px solid var(--wb-line-soft);
  border-radius: 8px;
  background: #fbfcfe;
}
.calc__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--wb-line-soft);
  flex-wrap: wrap;
}
.calc__no {
  width: 18px;
  flex: none;
  text-align: center;
  font-size: 12px;
  color: var(--wb-ink3);
}
.calc__select,
.calc__alias,
.calc__formula,
.calc__small {
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 7px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink);
  min-width: 0;
}
.calc__element {
  flex: 1 1 180px;
}
.calc__aggregate {
  flex: 0 0 80px;
}
.calc__operator {
  flex: 0 0 90px;
}
.calc__alias {
  flex: 0 0 88px;
}
.calc__placeholder {
  flex: 0 0 88px;
  color: var(--wb-ink3);
}
.calc__small {
  width: 78px;
}
.calc__del {
  flex: none;
  border: none;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  color: var(--wb-ink3);
  cursor: pointer;
}
.calc__del:hover {
  color: var(--wb-danger);
}
.calc__empty {
  padding: 14px;
  text-align: center;
  font-size: 12px;
  color: var(--wb-ink3);
}
.calc__add,
.calc__fn,
.calc__mode {
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink2);
  cursor: pointer;
}
.calc__add {
  margin-top: 8px;
  border-style: dashed;
}
.calc__formula {
  width: 100%;
  resize: vertical;
  line-height: 1.6;
}
.calc__tip {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--wb-ink3);
}
.calc__tip.is-error {
  color: var(--wb-danger);
}
.calc__fn-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 6px;
}
.calc__fn-label {
  font-size: 11.5px;
  color: var(--wb-ink3);
}
.calc__help-btn {
  width: 16px;
  height: 16px;
  flex: none;
  border: 1px solid var(--wb-line);
  border-radius: 50%;
  background: #fff;
  padding: 0;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  color: var(--wb-ink3);
  cursor: pointer;
}
.calc__help-btn:hover {
  border-color: var(--wb-primary);
  background: var(--wb-primary-soft);
  color: var(--wb-primary);
}
.calc__fn-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 5px;
}
.calc__fn-group-name {
  width: 72px;
  flex: none;
  font-size: 11px;
  color: var(--wb-ink3);
}
.calc__fn {
  padding: 3px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.calc__fn-help {
  margin-top: 8px;
  padding: 9px 11px;
  border: 1px solid var(--wb-line-soft);
  border-radius: 7px;
  background: var(--wb-bg);
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--wb-ink2);
}
.calc__fn-help--empty {
  color: var(--wb-ink3);
}
.calc__fn-help-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 3px;
}
.calc__fn-help-head code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--wb-primary);
}
.calc__fn-help-head span {
  color: var(--wb-ink3);
}
.calc__fn-help b {
  display: inline-block;
  width: 32px;
  color: var(--wb-ink3);
  font-weight: 600;
}
.calc__fn-help code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.calc__fn-help-desc {
  margin-top: 3px;
  color: var(--wb-ink3);
}
.calc__fn:hover,
.calc__mode:hover {
  border-color: var(--wb-primary);
  color: var(--wb-primary);
}
.calc__options {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.calc__option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--wb-ink2);
  cursor: pointer;
}
.calc__modes {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}
.calc__mode.is-active {
  border-color: var(--wb-primary);
  background: var(--wb-primary-soft);
  color: var(--wb-primary);
}
.calc__preview {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--wb-bg);
  font-size: 12px;
  color: var(--wb-ink2);
}
.calc__clear,
.calc__cancel,
.calc__ok {
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.calc__clear,
.calc__cancel {
  border: 1px solid var(--wb-line);
  background: #fff;
  color: var(--wb-ink2);
}
.calc__ok {
  border: 1px solid var(--wb-primary);
  background: var(--wb-primary);
  color: #fff;
}
.calc__spacer {
  flex: 1;
}
</style>
