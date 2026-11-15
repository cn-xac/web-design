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
  calculationFunctionGroups,
  collectCalculationTargets,
  collectConditionElements,
  evaluateCalculation,
  findLocation,
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
  Scope,
} from "@x-ac/web-design-core";
import { useDesigner } from "../context";
import type { CalculationTarget } from "../dialogs";
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
  const formulaRef = useRef<HTMLTextAreaElement | null>(null);
  /** 当前查看说明的函数；悬停 / 聚焦时切换，点击按钮仍只负责插入签名 */
  const [activeFn, setActiveFn] = useState<CalculationFunction | null>(null);
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

  const requiresAggregate = (path: string): boolean =>
    elements.find((element) => element.path === path)?.requiresAggregate ?? false;

  const labelOf = (path: string): string =>
    elements.find((element) => element.path === path)?.label ?? path;

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

  function insertFunction(signature: string): void {
    const element = formulaRef.current;
    const text = draft.formula;
    if (!element) {
      patch({ formula: text.trim() ? `${text.trim()} + ${signature}` : signature });
      return;
    }
    const start = element.selectionStart ?? text.length;
    const end = element.selectionEnd ?? start;
    patch({ formula: text.slice(0, start) + signature + text.slice(end) });
    const placeCursor = () => {
      element.focus();
      element.setSelectionRange(start + signature.length, start + signature.length);
    };
    // jsdom / SSR 环境不一定有 rAF，退化到 microtask 即可
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(placeCursor);
    else void Promise.resolve().then(placeCursor);
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
      width="760px"
      escToClose={!helpVisible}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="calc__clear" onClick={clear}>
            移除计算
          </button>
          <span className="calc__spacer" />
          <button type="button" className="calc__cancel" onClick={onClose}>
            取消
          </button>
          <button type="button" className="calc__ok" onClick={save}>
            确定
          </button>
        </>
      }
    >
      <div className="calc__hint">
        选择参与元素并写算式，运行时会自动算出结果并填入当前元素（回填路径：
        <span className="calc__path">{targetPath}</span>）。
        <br />
        引用子表单明细字段时需指定聚合口径；算式只允许受限运算与下方白名单函数，不会执行任意代码。
      </div>

      <div className="calc__section">参与元素</div>
      <div className="calc__rows wb-scroll">
        {draft.operands.map((operand, index) => (
          <div className="calc__row" key={index}>
            <span className="calc__no">{index + 1}</span>
            <select
              className="calc__select calc__element"
              aria-label="参与元素"
              value={operand.path}
              onChange={(event) => updateOperand(index, { path: event.target.value })}
            >
              <option value="">选择元素</option>
              {elements.map((element) => (
                <option key={element.nodeId} value={element.path}>
                  {element.label}（{element.path}）
                </option>
              ))}
            </select>
            {requiresAggregate(operand.path) ? (
              <select
                className="calc__select calc__aggregate"
                aria-label="聚合口径"
                value={operand.aggregate}
                onChange={(event) =>
                  updateOperand(index, { aggregate: event.target.value as ConditionAggregate })
                }
              >
                {CALCULATION_AGGREGATES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="calc__alias"
              type="text"
              aria-label="算式变量名"
              placeholder="变量名 A"
              value={operand.alias}
              onChange={(event) => updateOperand(index, { alias: event.target.value })}
            />
            <button
              type="button"
              className="calc__del"
              aria-label="删除参与元素"
              onClick={() => patch({ operands: draft.operands.filter((_, i) => i !== index) })}
            >
              ×
            </button>
          </div>
        ))}
        {!draft.operands.length ? <div className="calc__empty">还没有参与元素</div> : null}
      </div>
      <button
        type="button"
        className="calc__add"
        onClick={() =>
          patch({ operands: [...draft.operands, blankOperand(draft.operands.length)] })
        }
      >
        ＋ 添加元素
      </button>

      <div className="calc__section">算式</div>
      <textarea
        ref={formulaRef}
        className="calc__formula wb-mono"
        rows={3}
        spellCheck={false}
        placeholder="例如：A * B，或 ROUND(SUM(A, B), 2)"
        value={draft.formula}
        onChange={(event) => patch({ formula: event.target.value })}
      />
      <div className={`calc__tip${formulaError ? " is-error" : ""}`}>
        {formulaError || "用变量名引用参与元素；支持 + - * / %、比较、三元与括号。"}
      </div>

      <div className="calc__fn-title">
        <span className="calc__fn-label">高级函数（点击插入到光标处）</span>
        <button
          type="button"
          className="calc__help-btn"
          title="查看完整使用说明（通用规则 / 18 个函数 / 业务配方 / 排错）"
          aria-label="查看完整使用说明"
          onClick={() => setHelpVisible(true)}
        >
          ?
        </button>
      </div>
      {functionGroups.map((group) => (
        <div className="calc__fn-group" key={group.group}>
          <span className="calc__fn-group-name">{group.group}</span>
          {group.items.map((fn) => (
            <button
              type="button"
              className="calc__fn"
              key={fn.name}
              title={`${fn.signature} — ${fn.description}`}
              onMouseEnter={() => setActiveFn(fn)}
              onFocus={() => setActiveFn(fn)}
              onClick={() => insertFunction(fn.signature)}
            >
              {fn.name}
            </button>
          ))}
        </div>
      ))}

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
          <input
            className="calc__small"
            type="number"
            min={0}
            max={10}
            placeholder="原始精度"
            value={draft.precision}
            onChange={(event) => patch({ precision: event.target.value })}
          />
        </label>
        <label className="calc__option">
          输出形态
          <select
            className="calc__select"
            value={draft.output}
            onChange={(event) => patch({ output: event.target.value as CalculationOutput })}
          >
            <option value="number">数值</option>
            <option value="text">文本</option>
          </select>
        </label>
        <label className="calc__option">
          <input
            type="checkbox"
            checked={draft.emptyAsZero}
            onChange={(event) => patch({ emptyAsZero: event.target.checked })}
          />
          空值按 0 参与
        </label>
      </div>

      <div className="calc__section">参与条件（复用多条件组件契约）</div>
      <label className="calc__option">
        <input
          type="checkbox"
          checked={draft.whenEnabled}
          onChange={(event) => patch({ whenEnabled: event.target.checked })}
        />
        仅当条件命中时才计算
      </label>
      {draft.whenEnabled ? (
        <>
          <div className="calc__modes">
            {modeOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={`calc__mode${draft.whenMode === option.value ? " is-active" : ""}`}
                onClick={() => patch({ whenMode: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="calc__rows">
            {draft.whenRows.map((row, index) => (
              <div className="calc__row" key={index}>
                <select
                  className="calc__select calc__element"
                  aria-label="条件左元素"
                  value={row.left}
                  onChange={(event) => updateConditionRow(index, { left: event.target.value })}
                >
                  <option value="">选择元素</option>
                  {elements.map((element) => (
                    <option key={element.nodeId} value={element.path}>
                      {element.label}（{element.path}）
                    </option>
                  ))}
                </select>
                {requiresAggregate(row.left) ? (
                  <select
                    className="calc__select calc__aggregate"
                    aria-label="条件聚合口径"
                    value={row.aggregate}
                    onChange={(event) =>
                      updateConditionRow(index, {
                        aggregate: event.target.value as ConditionAggregate,
                      })
                    }
                  >
                    {CALCULATION_AGGREGATES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select
                  className="calc__select calc__operator"
                  aria-label="条件关系"
                  value={row.operator}
                  onChange={(event) =>
                    updateConditionRow(index, { operator: event.target.value as ConditionOperator })
                  }
                >
                  {CONDITION_OPERATOR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!isUnary(row.operator) ? (
                  <input
                    className="calc__alias"
                    type="text"
                    placeholder="比较值"
                    value={row.value}
                    onChange={(event) => updateConditionRow(index, { value: event.target.value })}
                  />
                ) : (
                  <span className="calc__placeholder">—</span>
                )}
                <button
                  type="button"
                  className="calc__del"
                  aria-label="删除条件"
                  onClick={() =>
                    patch({ whenRows: draft.whenRows.filter((_, i) => i !== index) })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            {!draft.whenRows.length ? <div className="calc__empty">还没有条件</div> : null}
          </div>
          <button
            type="button"
            className="calc__add"
            onClick={() => patch({ whenRows: [...draft.whenRows, blankConditionRow()] })}
          >
            ＋ 添加条件
          </button>
        </>
      ) : null}

      <div className="calc__preview">{preview}</div>
      {helpVisible ? <CalculationHelpDialog onClose={() => setHelpVisible(false)} /> : null}
    </ModalShell>
  );
}
