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
  FORMULA_NUMBER_BUTTONS,
  FORMULA_OPERATOR_BUTTONS,
  buildFunctionCall,
  calculationFunctionGroups,
  collectCalculationTargets,
  collectConditionElements,
  evaluateCalculation,
  findLocation,
  functionArgSlots,
  insertFormulaToken,
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
  type FunctionArgHint,
  type Scope,
} from "@x-ac/web-design-core";
import { useDesignerStore } from "../store";
import { useCalculationDialog } from "../dialogs";
import { useNotify } from "../ui/kit";
import ModalShell from "../ui/ModalShell.vue";
import UiControl from "../ui/UiControl.vue";
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
/** 算式输入框走 UiControl（适配包控件），用包裹层查询真实 textarea 以定位光标 */
const formulaHost = ref<HTMLElement | null>(null);
function formulaInput(): HTMLTextAreaElement | HTMLInputElement | null {
  return formulaHost.value?.querySelector("textarea, input") ?? null;
}
/** 当前查看说明的函数；悬停 / 聚焦时切换 */
const activeFn = ref<CalculationFunction | null>(null);
/** 正在做参数引导的函数（与悬停说明卡分开） */
const guideFn = ref<CalculationFunction | null>(null);
const argSlots = ref<Array<FunctionArgHint & { value: string }>>([]);
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

/** UiControl 的 Select 统一用 { label, value } 候选 */
const elementOptions = computed(() =>
  elements.value.map((element) => ({
    label: `${element.label}（${element.path}）`,
    value: element.path,
  })),
);
const aggregateOptions = computed(() =>
  CALCULATION_AGGREGATES.map((option) => ({ label: option.label, value: option.value })),
);
const operatorOptions = CONDITION_OPERATOR_OPTIONS.map((option) => ({
  label: option.label,
  value: option.value,
}));
const outputOptions = [
  { label: "数值", value: "number" },
  { label: "文本", value: "text" },
];
const guideElementOptions = computed(() =>
  draft.value.operands.map((operand) => ({
    label: `${operand.alias} · ${labelOf(operand.path) || operand.path}`,
    value: operand.path,
  })),
);

function blankOperand(): DraftOperand {
  return { path: "", alias: CALCULATION_ALIASES[draft.value.operands.length] ?? `V${draft.value.operands.length + 1}`, aggregate: "sum" };
}

function blankConditionRow(): DraftConditionRow {
  return { left: "", operator: "eq", value: "", aggregate: "sum" };
}

function load(): void {
  closeFunctionGuide();
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

/** 把 token 插到算式光标处；textarea 没有焦点时追加到末尾 */
function insertToken(token: string): void {
  const element = formulaInput();
  const text = draft.value.formula;
  const start = element?.selectionStart ?? text.length;
  const end = element?.selectionEnd ?? start;
  const result = insertFormulaToken(text, token, start, end);
  draft.value.formula = result.formula;
  void nextTick(() => {
    const el = formulaInput();
    if (!el) return;
    el.focus();
    el.setSelectionRange(result.cursor, result.cursor);
  });
}

/** Excel 式点选引用：点元素就把别名写进算式 */
function insertOperand(alias: string): void {
  if (alias.trim()) insertToken(alias.trim());
}

/** 点函数名：打开参数引导；无参函数直接插入调用 */
function beginFunctionGuide(fn: CalculationFunction): void {
  const slots = functionArgSlots(fn);
  if (!slots.length) {
    insertToken(buildFunctionCall(fn.name, []));
    return;
  }
  guideFn.value = fn;
  argSlots.value = slots.map((slot) => ({ ...slot, value: slot.default ?? "" }));
}

function closeFunctionGuide(): void {
  guideFn.value = null;
  argSlots.value = [];
}

/** 参数槽里点选元素：把该元素的别名填进当前槽 */
function setSlotFromElement(index: number, path: string): void {
  const alias = draft.value.operands.find((operand) => operand.path === path)?.alias;
  if (alias?.trim()) argSlots.value[index].value = alias.trim();
  else notify("请先在上方的参与元素中加入该元素", "error");
}

function onSlotElementChange(index: number, path: string): void {
  if (path) setSlotFromElement(index, path);
}

/** 参数填完 → 拼成调用文本插进算式 */
function insertGuidedFunction(): void {
  if (!guideFn.value) return;
  const values = argSlots.value.map((slot) => slot.value.trim());
  if (values.some((value) => !value)) {
    notify("请先填完每个参数，或点元素填入别名", "error");
    return;
  }
  insertToken(buildFunctionCall(guideFn.value.name, values));
  closeFunctionGuide();
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
  notify("高级计算已更新", "success");
}

function clear(): void {
  store.setCalculation(undefined);
  dialog.close();
  notify("已移除高级计算配置", "success");
}
</script>

<template>
  <ModalShell
    v-if="dialog.visible.value && dialog.target.value"
    title="配置高级计算"
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
        <UiControl
          as="Select"
          v-model="operand.path"
          :options="elementOptions"
          placeholder="选择元素"
          class="calc__select calc__element"
          aria-label="参与元素"
        />
        <UiControl
          v-if="requiresAggregate(operand.path)"
          as="Select"
          v-model="operand.aggregate"
          :options="aggregateOptions"
          class="calc__select calc__aggregate"
          aria-label="聚合口径"
        />
        <UiControl
          as="Input"
          v-model="operand.alias"
          class="calc__alias"
          type="text"
          aria-label="算式变量名"
          placeholder="变量名 A"
        />
        <UiControl
          v-if="operand.alias.trim()"
          as="Button"
          class="calc__insert"
          :title="`把 ${operand.alias} 插入算式`"
          @click="insertOperand(operand.alias)"
        >插入</UiControl>
        <UiControl as="Button" class="calc__del" aria-label="删除参与元素" @click="removeOperand(index)">×</UiControl>
      </div>
      <div v-if="!draft.operands.length" class="calc__empty">还没有参与元素</div>
    </div>
    <UiControl as="Button" class="calc__add" @click="addOperand">＋ 添加元素</UiControl>

    <div class="calc__section">算式</div>
    <div class="calc__builder">
      <div class="calc__token-row">
        <span class="calc__builder-label">点选元素</span>
        <UiControl
          v-for="operand in draft.operands.filter((item) => item.alias.trim())"
          :key="operand.alias"
          as="Button"
          class="calc__chip"
          :title="`插入 ${operand.alias}：${labelOf(operand.path) || operand.path}`"
          @click="insertOperand(operand.alias)"
        >{{ operand.alias }}</UiControl>
        <span v-if="!draft.operands.some((item) => item.alias.trim())" class="calc__builder-empty">
          先在上方添加参与元素
        </span>
      </div>
      <div class="calc__token-row">
        <span class="calc__builder-label">运算符</span>
        <UiControl
          v-for="button in FORMULA_OPERATOR_BUTTONS"
          :key="button.value"
          as="Button"
          class="calc__token"
          @click="insertToken(button.value)"
        >{{ button.label }}</UiControl>
      </div>
      <div class="calc__token-row">
        <span class="calc__builder-label">数字</span>
        <UiControl
          v-for="number in FORMULA_NUMBER_BUTTONS"
          :key="number"
          as="Button"
          class="calc__token"
          @click="insertToken(number)"
        >{{ number }}</UiControl>
      </div>
    </div>
    <div ref="formulaHost">
      <UiControl
        as="Input"
        v-model="draft.formula"
        class="calc__formula wb-mono"
        type="textarea"
        :rows="3"
        spellcheck="false"
        placeholder="例如：A * B，或 ROUND(SUM(A, B), 2)"
      />
    </div>
    <div class="calc__tip" :class="{ 'is-error': formulaError }">
      {{ formulaError || "用变量名引用参与元素；支持 + - * / %、比较、三元与括号。" }}
    </div>

    <div class="calc__fn-title">
      <span class="calc__fn-label">高级函数（点函数名 → 填参数 → 插入算式）</span>
      <UiControl
        as="Button"
        class="calc__help-btn"
        title="查看完整使用说明（通用规则 / 30 个函数 / 业务配方 / 排错）"
        aria-label="查看完整使用说明"
        @click="helpVisible = true"
      >?</UiControl>
    </div>
    <div v-for="group in functionGroups" :key="group.group" class="calc__fn-group">
      <span class="calc__fn-group-name">{{ group.group }}</span>
      <UiControl
        v-for="fn in group.items"
        :key="fn.name"
        as="Button"
        class="calc__fn"
        :title="`${fn.signature} — ${fn.description}`"
        @mouseenter="activeFn = fn"
        @focus="activeFn = fn"
        @click="beginFunctionGuide(fn)"
      >
        {{ fn.name }}
      </UiControl>
    </div>
    <div v-if="guideFn" class="calc__guide">
      <div class="calc__guide-head">
        <b>{{ guideFn.name }}</b>
        <span>逐项填入，或点选参与元素的别名</span>
        <UiControl as="Button" class="calc__guide-close" aria-label="取消参数引导" @click="closeFunctionGuide">×</UiControl>
      </div>
      <div v-for="(slot, index) in argSlots" :key="index" class="calc__guide-row">
        <span class="calc__guide-label">{{ slot.label }}</span>
        <UiControl as="Input" v-model="slot.value" class="calc__guide-input" type="text" :placeholder="slot.label" />
        <UiControl
          as="Select"
          :model-value="''"
          :options="guideElementOptions"
          placeholder="从元素选…"
          class="calc__guide-select"
          aria-label="从参与元素填入"
          @update:model-value="(path: string) => onSlotElementChange(index, path)"
        />
      </div>
      <div class="calc__guide-foot">
        <UiControl as="Button" class="calc__guide-cancel" @click="closeFunctionGuide">取消</UiControl>
        <UiControl as="Button" class="calc__guide-ok" @click="insertGuidedFunction">插入到算式</UiControl>
      </div>
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
        <UiControl as="Input" v-model="draft.precision" class="calc__small" type="number" :min="0" :max="10" placeholder="原始精度" />
      </label>
      <label class="calc__option">
        输出形态
        <UiControl as="Select" v-model="draft.output" :options="outputOptions" class="calc__select" />
      </label>
      <label class="calc__option">
        <UiControl as="Switch" :model-value="draft.emptyAsZero" @update:model-value="(v: boolean) => draft.emptyAsZero = v" />空值按 0 参与
      </label>
    </div>

    <div class="calc__section">参与条件（复用多条件组件契约）</div>
    <label class="calc__option">
      <UiControl as="Switch" :model-value="draft.whenEnabled" @update:model-value="(v: boolean) => draft.whenEnabled = v" />仅当条件命中时才计算
    </label>
    <template v-if="draft.whenEnabled">
      <div class="calc__modes">
        <UiControl
          v-for="option in modeOptions"
          :key="option.value"
          as="Button"
          class="calc__mode"
          :class="{ 'is-active': draft.whenMode === option.value }"
          @click="draft.whenMode = option.value"
        >
          {{ option.label }}
        </UiControl>
      </div>
      <div class="calc__rows">
        <div v-for="(row, index) in draft.whenRows" :key="index" class="calc__row">
          <UiControl as="Select" v-model="row.left" :options="elementOptions" placeholder="选择元素" class="calc__select calc__element" aria-label="条件左元素" />
          <UiControl
            v-if="requiresAggregate(row.left)"
            as="Select"
            v-model="row.aggregate"
            :options="aggregateOptions"
            class="calc__select calc__aggregate"
            aria-label="条件聚合口径"
          />
          <UiControl as="Select" v-model="row.operator" :options="operatorOptions" class="calc__select calc__operator" aria-label="条件关系" />
          <UiControl v-if="!isUnary(row.operator)" as="Input" v-model="row.value" class="calc__alias" type="text" placeholder="比较值" />
          <span v-else class="calc__placeholder">—</span>
          <UiControl as="Button" class="calc__del" aria-label="删除条件" @click="removeConditionRow(index)">×</UiControl>
        </div>
        <div v-if="!draft.whenRows.length" class="calc__empty">还没有条件</div>
      </div>
      <UiControl as="Button" class="calc__add" @click="addConditionRow">＋ 添加条件</UiControl>
    </template>

    <div class="calc__preview">{{ preview }}</div>

    <template #footer>
      <UiControl as="Button" class="calc__clear" @click="clear">移除计算</UiControl>
      <span class="calc__spacer" />
      <UiControl as="Button" class="calc__cancel" @click="dialog.close()">取消</UiControl>
      <UiControl as="Button" type="primary" class="calc__ok" @click="save">确定</UiControl>
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
.calc__select:where(input,select,textarea),
.calc__alias:where(input,select,textarea),
.calc__formula:where(input,select,textarea),
.calc__small:where(input,select,textarea){
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
.calc__insert {
  flex: none;
  border: 1px solid var(--wb-line);
  border-radius: 4px;
  background: var(--wb-primary-soft);
  padding: 3px 6px;
  font-size: 11px;
  font-family: inherit;
  color: var(--wb-primary);
  cursor: pointer;
}
.calc__insert:hover {
  border-color: var(--wb-primary);
}
.calc__builder {
  padding: 8px;
  border: 1px solid var(--wb-line-soft);
  border-radius: 8px;
  background: var(--wb-bg);
}
.calc__token-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.calc__token-row:last-child {
  margin-bottom: 0;
}
.calc__builder-label {
  width: 56px;
  flex: none;
  font-size: 11px;
  color: var(--wb-ink3);
}
.calc__chip,
.calc__token {
  border: 1px solid var(--wb-line);
  border-radius: 4px;
  background: #fff;
  padding: 3px 7px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--wb-ink2);
  cursor: pointer;
}
.calc__chip {
  font-weight: 700;
  color: var(--wb-primary);
  background: var(--wb-primary-soft);
  border-color: transparent;
}
.calc__chip:hover,
.calc__token:hover {
  border-color: var(--wb-primary);
  color: var(--wb-primary);
}
.calc__builder-empty {
  font-size: 11px;
  color: var(--wb-ink3);
}
.calc__guide {
  margin-top: 8px;
  padding: 9px 11px;
  border: 1px solid var(--wb-primary);
  border-radius: 7px;
  background: var(--wb-primary-soft);
}
.calc__guide-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  font-size: 12px;
  color: var(--wb-ink2);
}
.calc__guide-head b {
  color: var(--wb-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.calc__guide-close {
  margin-left: auto;
  border: none;
  background: transparent;
  font-size: 15px;
  color: var(--wb-ink3);
  cursor: pointer;
}
.calc__guide-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.calc__guide-label {
  width: 108px;
  flex: none;
  font-size: 11.5px;
  color: var(--wb-ink2);
}
.calc__guide-input:where(input,select,textarea),
.calc__guide-select:where(input,select,textarea){
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 4px 6px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink);
  min-width: 0;
}
.calc__guide-input {
  flex: 1 1 120px;
}
.calc__guide-select {
  flex: 0 0 160px;
}
.calc__guide-foot {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}
.calc__guide-cancel,
.calc__guide-ok {
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.calc__guide-cancel {
  border: 1px solid var(--wb-line);
  background: #fff;
  color: var(--wb-ink2);
}
.calc__guide-ok {
  border: 1px solid var(--wb-primary);
  background: var(--wb-primary);
  color: #fff;
}
</style>
