/**
 * 逻辑面板：高级计算、显示隐藏、渲染条件、循环数据。
 * 与 Vue 版 LogicEditor.vue 对齐：这四项都是节点行为 / 数据逻辑，
 * 与纯视觉样式无关，从样式面板独立出来。
 */
import { useDesigner } from "../context";
import { UiControl } from "../ui";
import { ConditionTrigger } from "./ConditionBuilder";
import { CalculationTrigger } from "./CalculationTrigger";

const DIRECTIVES: Array<{
  name: "show" | "if" | "for";
  label: string;
  tip: string;
  placeholder: string;
}> = [
  { name: "show", label: "显示条件", tip: "不满足时渲染但隐藏，如 list.length > 0", placeholder: "list.length > 0" },
  { name: "if", label: "渲染条件", tip: "不满足时完全不渲染，适合有明显副作用的组件", placeholder: "form.type === 'a'" },
  { name: "for", label: "循环数据", tip: "绑定数组，子组件内用 item / index 访问", placeholder: "{{list}}" },
];

export function LogicEditor() {
  const { state, store } = useDesigner();
  const node = state.selectedNode;
  if (!node) return null;

  const directiveValue = (name: "show" | "if" | "for"): string =>
    node.directives?.find((item) => item.name === name)?.value ?? "";

  return (
    <div className="logic">
      <div className="style__section">高级计算（数据计算）</div>
      <div className="style__row style__row--block">
        <label>高级计算</label>
        <CalculationTrigger />
        <div className="style__tip">
          仅文字 / 数字元素可配置高级计算；结果自动填入当前元素，支持高级函数与子表单聚合
        </div>
      </div>

      <div className="style__section">显示 / 隐藏条件</div>
      <div className="style__row style__row--block">
        <label>条件显隐</label>
        <ConditionTrigger />
        <div className="style__tip">一组条件 + 命中动作，未命中取反，无中间态</div>
      </div>

      <div className="style__section">显示与循环（旧指令）</div>
      {DIRECTIVES.map((directive) => (
        <div className="style__row style__row--block" key={directive.name}>
          <label>{directive.label}</label>
          <UiControl
            as="Input"
            size="small"
            value={directiveValue(directive.name)}
            placeholder={directive.placeholder}
            onChange={(v: unknown) => store.setDirective(directive.name, String(v ?? ""))}
          />
          <div className="style__tip">{directive.tip}</div>
        </div>
      ))}
    </div>
  );
}
