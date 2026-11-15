/**
 * 数据计算入口（对齐 Vue StyleEditor 的「自动计算 · 配置」按钮）。
 * 计算编辑在计算弹窗里完成；这里只负责摘要与资格判定。
 */
import { canOwnCalculation } from "@x-ac/web-design-core";
import { useDesigner } from "../context";
import { useDesignerDialogs } from "../dialogs";

export function CalculationTrigger() {
  const { state } = useDesigner();
  const dialogs = useDesignerDialogs();
  const node = state.selectedNode;
  if (!node) return null;

  const allowed = canOwnCalculation(node);
  const config = node.calculation;
  const summary = config ? `${config.operands.length} 个元素 · ${config.formula}` : "未配置";

  return (
    <button
      type="button"
      className="style__cond-btn style__calc-btn"
      disabled={!allowed}
      onClick={() =>
        dialogs.openCalculation({
          nodeId: node.id,
          label: String(node.props?.label ?? node.component),
        })
      }
    >
      {summary} · 配置高级计算
    </button>
  );
}
