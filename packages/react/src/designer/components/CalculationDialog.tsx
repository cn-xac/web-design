/**
 * 数据计算弹窗（React 版，对齐 Vue 的 CalculationDialog.vue）。
 *
 * 编辑的全部是纯数据：参与元素（路径 + 别名 + 聚合口径）、算式、参与条件与输出口径；
 * 求值由 core 的 evaluateCalculation / applyCalculations 承担，两端行为一致。
 * 「参与条件」复用 rfD7Jv 的 ConditionGroup 契约与 evaluateConditionGroup 求值。
 */
import { useMemo, useRef, useState } from "react";
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
} from "@x-ac/web-design-core";
import type {
  CalculationConfig,
  CalculationFunction,
  CalculationOperand,
  CalculationOutput,
  ConditionAggregate,
  ConditionMode,
  ConditionOperator,
  ConditionRow,
  FunctionArgHint,
  Scope,
} from "@x-ac/web-design-core";
import { useDesigner } from "../context";
import type { CalculationTarget } from "../dialogs";
import { UiControl } from "../ui";
import { ModalShell } from "./ModalShell";
import { CalculationHelpDialog } from "./CalculationHelpDialog";

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

interface Draft {
  operands: DraftOperand[];
  formula: string;
  precision: string;
  emptyAsZero: boolean;
  output: CalculationOutput;
  whenEnabled: boolean;
  whenMode: ConditionMode;
  whenRows: DraftConditionRow[];
}

const blankOperand = (index: number): DraftOperand => ({
  path: "",
  alias: CALCULATION_ALIASES[index] ?? `V${index + 1}`,
  aggregate: "sum",
});

const blankConditionRow = (): DraftConditionRow => ({
  left: "",
  operator: "eq",
  value: "",
  aggregate: "sum",
});

function normalize(config: CalculationConfig | undefined): Draft {
  if (!config) {
    return {
      operands: [blankOperand(0)],
      formula: "",
      precision: "",
      emptyAsZero: false,
      output: "number",
      whenEnabled: false,
      whenMode: "and",
      whenRows: [],
    };
  }
  return {
    operands: config.operands.length
      ? config.operands.map((operand) => ({
          path: operand.path,
          alias: operand.alias,
          aggregate: operand.aggregate ?? "sum",
        }))
      : [blankOperand(0)],
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

export interface CalculationDialogProps {
  target: CalculationTarget;
  onClose: () => void;
}

export function CalculationDialog({ target, onClose }: CalculationDialogProps) {
  const { store, state, notify } = useDesigner();
  const initial = findLocation(state.page.children ?? [], target.nodeId)?.node?.calculation;
  const [draft, setDraft] = useState<Draft>(() => normalize(initial));
  /** 算式输入框走 UiControl，用包裹层查询真实 textarea 以定位光标 */
  const formulaHost = useRef<HTMLDivElement | null>(null);
  const formulaInput = (): HTMLTextAreaElement | HTMLInputElement | null =>
    formulaHost.current?.querySelector("textarea, input") ?? null;
  /** 当前查看说明的函数；悬停 / 聚焦时切换 */
  const [activeFn, setActiveFn] = useState<CalculationFunction | null>(null);
  /** 正在做参数引导的函数（与悬停说明卡分开） */
  const [guideFn, setGuideFn] = useState<CalculationFunction | null>(null);
  const [argSlots, setArgSlots] = useState<Array<FunctionArgHint & { value: string }>>([]);
  /** 完整使用说明（内容较长，单独一层弹窗承载） */
  const [helpVisible, setHelpVisible] = useState(false);

  const elements = useMemo(
    () => collectConditionElements(state.page, { nodeId: target.nodeId }),
    [state.page, target.nodeId],
  );
  const targetPath = useMemo(
    () =>
      collectCalculationTargets(state.page).find((item) => item.nodeId === target.nodeId)?.path ?? "",
    [state.page, target.nodeId],
  );
  const functionGroups = useMemo(() => calculationFunctionGroups(), []);
  const modeOptions = CONDITION_MODE_OPTIONS.filter((option) => option.value !== "advanced");

  /** UiControl 的 Select 统一用 { label, value } 候选 */
  const elementOptions = elements.map((element) => ({
    label: `${element.label}（${element.path}）`,
    value: element.path,
  }));
  const aggregateOptions = CALCULATION_AGGREGATES.map((option) => ({
    label: option.label,
    value: option.value,
  }));
  const operatorOptions = CONDITION_OPERATOR_OPTIONS.map((option) => ({
    label: option.label,
    value: option.value,
  }));
  const outputOptions = [
    { label: "数值", value: "number" },
    { label: "文本", value: "text" },
  ];
  const requiresAggregate = (path: string): boolean =>
    elements.find((element) => element.path === path)?.requiresAggregate ?? false;

  const labelOf = (path: string): string =>
    elements.find((element) => element.path === path)?.label ?? path;

  const guideElementOptions = draft.operands.map((operand) => ({
    label: `${operand.alias} · ${labelOf(operand.path) || operand.path}`,
    value: operand.path,
  }));

  const isUnary = (operator: ConditionOperator): boolean =>
    CONDITION_OPERATOR_OPTIONS.find((option) => option.value === operator)?.unary ?? false;

  const patch = (partial: Partial<Draft>): void =>
    setDraft((current) => ({ ...current, ...partial }));

  const updateOperand = (index: number, partial: Partial<DraftOperand>): void =>
    setDraft((current) => ({
      ...current,
      operands: current.operands.map((row, i) => (i === index ? { ...row, ...partial } : row)),
    }));

  const updateConditionRow = (index: number, partial: Partial<DraftConditionRow>): void =>
    setDraft((current) => ({
      ...current,
      whenRows: current.whenRows.map((row, i) => (i === index ? { ...row, ...partial } : row)),
    }));

  function buildConfig(): CalculationConfig | null {
    const operands: CalculationOperand[] = draft.operands
      .filter((operand) => operand.path && operand.alias.trim())
      .map((operand) => ({
        path: operand.path,
        alias: operand.alias.trim(),
        label: labelOf(operand.path),
        ...(requiresAggregate(operand.path) ? { aggregate: operand.aggregate } : {}),
      }));
    if (!operands.length) return null;

    const whenRows: ConditionRow[] = draft.whenEnabled
      ? draft.whenRows
          .filter((row) => row.left && row.operator)
          .map((row) => ({
            left: row.left,
            operator: row.operator,
            ...(requiresAggregate(row.left) ? { aggregate: row.aggregate } : {}),
            ...(isUnary(row.operator) ? {} : { value: row.value }),
          }))
      : [];

    const rawPrecision = Number(draft.precision.trim());
    return {
      operands,
      formula: draft.formula.trim(),
      ...(draft.precision.trim() !== "" && Number.isFinite(rawPrecision) ? { precision: rawPrecision } : {}),
      emptyAsZero: draft.emptyAsZero,
      output: draft.output,
      ...(whenRows.length ? { when: { mode: draft.whenMode, rows: whenRows } } : {}),
    };
  }

  const formulaError = validateCalculationFormula(draft.formula);
  const preview = (() => {
    if (formulaError) return "算式语法有误，暂不能试算";
    const config = buildConfig();
    if (!config) return "请先选择至少一个参与元素";
    const scope: Scope = JSON.parse(JSON.stringify(state.page.state ?? {})) as Scope;
    for (const operand of config.operands) setByPath(scope, operand.path, 1);
    const outcome = evaluateCalculation(config, scope, 0);
    return outcome.skipped
      ? `未参与计算：${outcome.reason ?? "条件未命中"}`
      : `试算结果：${String(outcome.value)}（每个参与元素按 1 代入）`;
  })();

  /** 把 token 插到算式光标处；textarea 没有焦点时追加到末尾 */
  function insertToken(token: string): void {
    const element = formulaInput();
    const text = draft.formula;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? start;
    const result = insertFormulaToken(text, token, start, end);
    patch({ formula: result.formula });
    const placeCursor = () => {
      const el = formulaInput();
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.cursor, result.cursor);
    };
    // jsdom / SSR 环境不一定有 rAF，退化到 microtask 即可
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(placeCursor);
    else void Promise.resolve().then(placeCursor);
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
    setGuideFn(fn);
    setArgSlots(slots.map((slot) => ({ ...slot, value: slot.default ?? "" })));
  }

  function closeFunctionGuide(): void {
    setGuideFn(null);
    setArgSlots([]);
  }

  function updateArgSlot(index: number, value: string): void {
    setArgSlots((current) => current.map((slot, i) => (i === index ? { ...slot, value } : slot)));
  }

  /** 参数槽里点选元素：把别名填进当前槽 */
  function setSlotFromElement(index: number, path: string): void {
    const alias = draft.operands.find((operand) => operand.path === path)?.alias;
    if (alias?.trim()) updateArgSlot(index, alias.trim());
    else notify("请先在上方的参与元素中加入该元素", "error");
  }

  /** 参数填完 → 拼成调用文本插进算式 */
  function insertGuidedFunction(): void {
    if (!guideFn) return;
    const values = argSlots.map((slot) => slot.value.trim());
    if (values.some((value) => !value)) {
      notify("请先填完每个参数，或点元素填入别名", "error");
      return;
    }
    insertToken(buildFunctionCall(guideFn.name, values));
    closeFunctionGuide();
  }

  function save(): void {
    const config = buildConfig();
    if (!config) {
      notify("请至少选择一个参与元素", "error");
      return;
    }
    const errors = validateCalculationConfig(config, targetPath || undefined);
    if (errors.length) {
      notify(errors[0], "error");
      return;
    }
    store.setCalculation(config);
    onClose();
    notify("高级计算已更新", "success");
  }

  function clear(): void {
    store.setCalculation(undefined);
    onClose();
    notify("已移除高级计算配置", "success");
  }

  return (
    <ModalShell
      title="配置高级计算"
      width="980px"
      escToClose={!helpVisible}
      onClose={onClose}
      footer={
        <>
          <UiControl as="Button" className="calc__clear" onClick={clear}>
            移除计算
          </UiControl>
          <span className="calc__spacer" />
          <UiControl as="Button" className="calc__cancel" onClick={onClose}>
            取消
          </UiControl>
          <UiControl as="Button" type="primary" className="calc__ok" onClick={save}>
            确定
          </UiControl>
        </>
      }
    >
      <div className="calc__hint">
        选择参与元素并写算式，运行时会自动算出结果并填入当前元素（回填路径：
        <span className="calc__path">{targetPath}</span>）。
        <br />
        引用子表单明细字段时需指定聚合口径；算式只允许受限运算与下方白名单函数，不会执行任意代码。
      </div>

      <div className="calc__layout">
      <div className="calc__left">
      <div className="calc__section">参与元素</div>
      <div className="calc__rows calc__rows--left wb-scroll">
        {draft.operands.map((operand, index) => (
          <div className="calc__row" key={index}>
            <span className="calc__no">{index + 1}</span>
            <UiControl
              as="Select"
              className="calc__select calc__element"
              aria-label="参与元素"
              placeholder="选择元素"
              value={operand.path}
              options={elementOptions}
              onChange={(value: string) => updateOperand(index, { path: value })}
            />
            {requiresAggregate(operand.path) ? (
              <UiControl
                as="Select"
                className="calc__select calc__aggregate"
                aria-label="聚合口径"
                value={operand.aggregate}
                options={aggregateOptions}
                onChange={(value: string) =>
                  updateOperand(index, { aggregate: value as ConditionAggregate })
                }
              />
            ) : null}
            <UiControl
              as="Input"
              className="calc__alias"
              type="text"
              aria-label="算式变量名"
              placeholder="变量名 A"
              value={operand.alias}
              onChange={(value: string) => updateOperand(index, { alias: value })}
            />
            {operand.alias.trim() ? (
              <UiControl
                as="Button"
                className="calc__insert"
                title={`把 ${operand.alias} 插入算式`}
                onClick={() => insertOperand(operand.alias)}
              >
                插入
              </UiControl>
            ) : null}
            <UiControl
              as="Button"
              className="calc__del"
              aria-label="删除参与元素"
              onClick={() => patch({ operands: draft.operands.filter((_, i) => i !== index) })}
            >
              ×
            </UiControl>
          </div>
        ))}
        {!draft.operands.length ? <div className="calc__empty">还没有参与元素</div> : null}
      </div>
      <UiControl
        as="Button"
        className="calc__add"
        onClick={() =>
          patch({ operands: [...draft.operands, blankOperand(draft.operands.length)] })
        }
      >
        ＋ 添加元素
      </UiControl>
      </div>{/* /calc__left */}

      <div className="calc__right">
      <div className="calc__section">算式</div>
      <div className="calc__builder">
        <div className="calc__token-row">
          <span className="calc__builder-label">点选元素</span>
          {draft.operands
            .filter((operand) => operand.alias.trim())
            .map((operand) => (
              <UiControl
                as="Button"
                key={operand.alias}
                className="calc__chip"
                title={`插入 ${operand.alias}：${labelOf(operand.path) || operand.path}`}
                onClick={() => insertOperand(operand.alias)}
              >
                {operand.alias}
              </UiControl>
            ))}
          {!draft.operands.some((operand) => operand.alias.trim()) ? (
            <span className="calc__builder-empty">先在上方添加参与元素</span>
          ) : null}
        </div>
        <div className="calc__token-row">
          <span className="calc__builder-label">运算符</span>
          {FORMULA_OPERATOR_BUTTONS.map((button) => (
            <UiControl
              as="Button"
              key={button.value}
              className="calc__token"
              onClick={() => insertToken(button.value)}
            >
              {button.label}
            </UiControl>
          ))}
        </div>
        <div className="calc__token-row">
          <span className="calc__builder-label">数字</span>
          {FORMULA_NUMBER_BUTTONS.map((number) => (
            <UiControl as="Button" key={number} className="calc__token" onClick={() => insertToken(number)}>
              {number}
            </UiControl>
          ))}
        </div>
      </div>
      <div ref={formulaHost}>
        <UiControl
          as="Input"
          className="calc__formula wb-mono"
          rows={3}
          spellCheck={false}
          placeholder="例如：A * B，或 ROUND(SUM(A, B), 2)"
          value={draft.formula}
          onChange={(value: string) => patch({ formula: value })}
        />
      </div>
      <div className={`calc__tip${formulaError ? " is-error" : ""}`}>
        {formulaError || "用变量名引用参与元素；支持 + - * / %、比较、三元与括号。"}
      </div>

      <div className="calc__fn-title">
        <span className="calc__fn-label">高级函数（点函数名 → 填参数 → 插入算式）</span>
        <UiControl
          as="Button"
          className="calc__help-btn"
          title="查看完整使用说明（通用规则 / 30 个函数 / 业务配方 / 排错）"
          aria-label="查看完整使用说明"
          onClick={() => setHelpVisible(true)}
        >
          ?
        </UiControl>
      </div>
      {functionGroups.map((group) => (
        <div className="calc__fn-group" key={group.group}>
          <span className="calc__fn-group-name">{group.group}</span>
          {group.items.map((fn) => (
            <UiControl
              as="Button"
              className="calc__fn"
              key={fn.name}
              title={`${fn.signature} — ${fn.description}`}
              onMouseEnter={() => setActiveFn(fn)}
              onFocus={() => setActiveFn(fn)}
              onClick={() => beginFunctionGuide(fn)}
            >
              {fn.name}
            </UiControl>
          ))}
        </div>
      ))}

      {guideFn ? (
        <div className="calc__guide" key={guideFn.name}>
          <div className="calc__guide-head">
            <b>{guideFn.name}</b>
            <span>逐项填入，或点选参与元素的别名</span>
            <UiControl
              as="Button"
              className="calc__guide-close"
              aria-label="取消参数引导"
              onClick={closeFunctionGuide}
            >
              ×
            </UiControl>
          </div>
          {argSlots.map((slot, index) => (
            <div className="calc__guide-row" key={`${guideFn.name}-${index}`}>
              <span className="calc__guide-label">{slot.label}</span>
              <UiControl
                as="Input"
                className="calc__guide-input"
                type="text"
                placeholder={slot.label}
                value={slot.value}
                onChange={(value: string) => updateArgSlot(index, value)}
              />
              <UiControl
                as="Select"
                className="calc__guide-select"
                aria-label="从参与元素填入"
                value=""
                options={guideElementOptions}
                placeholder="从元素选…"
                onChange={(value: string) => {
                  if (value) setSlotFromElement(index, value);
                }}
              />
            </div>
          ))}
          <div className="calc__guide-foot">
            <UiControl as="Button" className="calc__guide-cancel" onClick={closeFunctionGuide}>
              取消
            </UiControl>
            <UiControl as="Button" className="calc__guide-ok" onClick={insertGuidedFunction}>
              插入到算式
            </UiControl>
          </div>
        </div>
      ) : null}

      {activeFn ? (
        <div className="calc__fn-help">
          <div className="calc__fn-help-head">
            <code>{activeFn.signature}</code>
            <span>
              {activeFn.label} · {activeFn.group}
            </span>
          </div>
          <div>
            <b>参数</b> {activeFn.params}
          </div>
          <div>
            <b>返回</b> {activeFn.returns}
          </div>
          <div>
            <b>示例</b> <code>{activeFn.example}</code>
          </div>
          <div className="calc__fn-help-desc">{activeFn.description}</div>
        </div>
      ) : (
        <div className="calc__fn-help calc__fn-help--empty">
          悬停函数名查看单函数说明，点击函数插入签名；点右侧 ? 查看完整使用说明。
        </div>
      )}

      <div className="calc__section">输出设置</div>
      <div className="calc__options">
        <label className="calc__option">
          小数位
          <UiControl
            as="Input"
            className="calc__small"
            type="number"
            min={0}
            max={10}
            placeholder="原始精度"
            value={draft.precision}
            onChange={(value: string) => patch({ precision: value })}
          />
        </label>
        <label className="calc__option">
          输出形态
          <UiControl
            as="Select"
            className="calc__select"
            value={draft.output}
            options={outputOptions}
            onChange={(value: string) => patch({ output: value as CalculationOutput })}
          />
        </label>
        <label className="calc__option">
          <UiControl
            as="Switch"
            value={draft.emptyAsZero}
            onChange={(value: boolean) => patch({ emptyAsZero: value })}
          />
          空值按 0 参与
        </label>
      </div>

      <div className="calc__section">参与条件（复用多条件组件契约）</div>
      <label className="calc__option">
        <UiControl
          as="Switch"
          value={draft.whenEnabled}
          onChange={(value: boolean) => patch({ whenEnabled: value })}
        />
        仅当条件命中时才计算
      </label>
      {draft.whenEnabled ? (
        <>
          <div className="calc__modes">
            {modeOptions.map((option) => (
              <UiControl
                as="Button"
                key={option.value}
                className={`calc__mode${draft.whenMode === option.value ? " is-active" : ""}`}
                onClick={() => patch({ whenMode: option.value })}
              >
                {option.label}
              </UiControl>
            ))}
          </div>
          <div className="calc__rows">
            {draft.whenRows.map((row, index) => (
              <div className="calc__row" key={index}>
                <UiControl
                  as="Select"
                  className="calc__select calc__element"
                  aria-label="条件左元素"
                  placeholder="选择元素"
                  value={row.left}
                  options={elementOptions}
                  onChange={(value: string) => updateConditionRow(index, { left: value })}
                />
                {requiresAggregate(row.left) ? (
                  <UiControl
                    as="Select"
                    className="calc__select calc__aggregate"
                    aria-label="条件聚合口径"
                    value={row.aggregate}
                    options={aggregateOptions}
                    onChange={(value: string) =>
                      updateConditionRow(index, { aggregate: value as ConditionAggregate })
                    }
                  />
                ) : null}
                <UiControl
                  as="Select"
                  className="calc__select calc__operator"
                  aria-label="条件关系"
                  value={row.operator}
                  options={operatorOptions}
                  onChange={(value: string) =>
                    updateConditionRow(index, { operator: value as ConditionOperator })
                  }
                />
                {!isUnary(row.operator) ? (
                  <UiControl
                    as="Input"
                    className="calc__alias"
                    type="text"
                    placeholder="比较值"
                    value={row.value}
                    onChange={(value: string) => updateConditionRow(index, { value })}
                  />
                ) : (
                  <span className="calc__placeholder">—</span>
                )}
                <UiControl
                  as="Button"
                  className="calc__del"
                  aria-label="删除条件"
                  onClick={() =>
                    patch({ whenRows: draft.whenRows.filter((_, i) => i !== index) })
                  }
                >
                  ×
                </UiControl>
              </div>
            ))}
            {!draft.whenRows.length ? <div className="calc__empty">还没有条件</div> : null}
          </div>
          <UiControl
            as="Button"
            className="calc__add"
            onClick={() => patch({ whenRows: [...draft.whenRows, blankConditionRow()] })}
          >
            ＋ 添加条件
          </UiControl>
        </>
      ) : null}
      </div>{/* /calc__right */}
      </div>{/* /calc__layout */}

      <div className="calc__preview">{preview}</div>
      {helpVisible ? <CalculationHelpDialog onClose={() => setHelpVisible(false)} /> : null}
    </ModalShell>
  );
}
