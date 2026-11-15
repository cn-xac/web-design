/**
 * 高级函数「完整使用说明」弹窗（React 版，对齐 Vue CalculationHelpDialog.vue）。
 *
 * 内容较长，用独立一层弹窗承载；createPortal 到 body，避开 ModalShell 的 overflow 裁剪。
 * 全部文本来自 core 常量，与 docs/CALCULATION_FUNCTIONS.md 同源。
 */
import {
  CALCULATION_RECIPES,
  CALCULATION_TROUBLESHOOTING,
  CALCULATION_USAGE_NOTES,
  calculationFunctionGroups,
} from "@x-ac/web-design-core";
import { createPortal } from "react-dom";
import { ModalShell } from "./ModalShell";

export interface CalculationHelpDialogProps {
  onClose: () => void;
}

export function CalculationHelpDialog({ onClose }: CalculationHelpDialogProps) {
  // SSR 环境没有 document，直接不渲染（设计器弹窗只在浏览器交互中出现）
  if (typeof document === "undefined") return null;
  const groups = calculationFunctionGroups();

  return createPortal(
    <ModalShell title="高级函数使用说明" width="860px" onClose={onClose} footer={<>
      <button type="button" className="calc__help-close" onClick={onClose}>
        关闭
      </button>
    </>}>
      <div className="calc__help">
        <p className="calc__help-intro">
          高级函数只在数据计算算式里可用；函数名必须命中下方 18 个白名单，
          通用绑定表达式仍禁止函数调用。点击函数名可把签名插入算式，悬停可看单函数说明。
        </p>

        <section className="calc__help-block">
          <h4>一、通用规则</h4>
          <ol className="calc__help-list">
            {CALCULATION_USAGE_NOTES.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ol>
        </section>

        <section className="calc__help-block">
          <h4>二、函数参考（18 个）</h4>
          {groups.map((group) => (
            <div className="calc__help-group" key={group.group}>
              <h5>
                {group.group}（{group.items.length}）
              </h5>
              <div className="calc__help-grid">
                {group.items.map((fn) => (
                  <div className="calc__help-fn" key={fn.name}>
                    <div className="calc__help-fn-head">
                      <code>{fn.signature}</code>
                      <span>{fn.label}</span>
                    </div>
                    <div><b>参数</b>{fn.params}</div>
                    <div><b>返回</b>{fn.returns}</div>
                    <div><b>示例</b><code>{fn.example}</code></div>
                    <div className="calc__help-fn-desc">{fn.description}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="calc__help-block">
          <h4>三、常见业务配方</h4>
          <table className="calc__help-table">
            <thead>
              <tr><th>场景</th><th>参与元素</th><th>算式 / 配置</th></tr>
            </thead>
            <tbody>
              {CALCULATION_RECIPES.map((recipe, index) => (
                <tr key={index}>
                  <td>{recipe.scene}</td>
                  <td>{recipe.operands}</td>
                  <td><code>{recipe.formula}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="calc__help-block">
          <h4>四、限制与排错</h4>
          <table className="calc__help-table">
            <thead>
              <tr><th>现象</th><th>原因</th><th>处理</th></tr>
            </thead>
            <tbody>
              {CALCULATION_TROUBLESHOOTING.map((item, index) => (
                <tr key={index}>
                  <td>{item.symptom}</td>
                  <td>{item.cause}</td>
                  <td>{item.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="calc__help-foot">
          完整手册：<code>docs/CALCULATION_FUNCTIONS.md</code>。本页内容由 core 常量生成，新增函数只需改内核函数表。
        </p>
      </div>
    </ModalShell>,
    document.body,
  );
}
