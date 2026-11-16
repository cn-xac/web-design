/**
 * 数据计算「高级函数使用说明」的内容常量。
 *
 * 目的：设计器弹窗里的长说明与 `docs/CALCULATION_FUNCTIONS.md` 同源，
 * 避免 UI 写死一份、文档写另一份。函数本身的参数 / 返回 / 示例仍来自
 * `CALCULATION_FUNCTIONS`，这里只补「规则 / 配方 / 排错」三类说明文本。
 *
 * 纯数据、零依赖，core 不感知任何 UI。
 */

/** 一个业务配方：场景 + 参与元素 + 算式 */
export interface CalculationRecipe {
  scene: string;
  operands: string;
  formula: string;
}

/** 一条排错项 */
export interface CalculationTroubleshooting {
  symptom: string;
  cause: string;
  fix: string;
}

/** 与安全边界、别名、空值、参数有关的通用规则 */
export const CALCULATION_USAGE_NOTES: readonly string[] = [
  "别名即变量：A / B / C… 来自参与元素，也可用 price 这类自定义名；必须字母开头、不可重复，不能占用 form / data / scope / 函数名等保留字。",
  "数值转换（数值优先）：算式的 + - * / % 与比较运算先把两边尝试转成有限数值，\"12\" + 3 = 15、\"12\" * 3 = 36；转不成数值时 + 回落到字符串拼接，其余算术符返回空值。聚合与数学函数只认有限数值参数，非数值会被忽略。通用 {{path}} 绑定仍是严格语义，不受影响。",
  "数组展开：参数若是从作用域取到的数组会按元素展开；Schema 里不写数组字面量（表达式层不支持 [1,2] 这种写法）。",
  "空值口径：任一参与元素为空且未勾选「空值按 0 参与」时，整个结果清空（不进入函数）；勾选后空值按 0 代入。",
  "参数个数：不足或超出时函数返回空值，最终显示为空字符串，不会抛错，也不会留下脏值。",
  "大小写：函数名大小写不敏感（sum 与 SUM 等价），但变量别名区分大小写。",
  "运算能力：函数可与 + - * / %、比较、&& || !、三元 ?:、括号、路径（如 form.taxRate）自由组合；IF 的三个参数都会先求值，但均无副作用。",
  "结果归一：precision 对最终数值再四舍五入（0~10 位）；output: text 把结果转字符串；非有限数值（除零等）转为空串。",
  "安全边界：函数名必须命中 30 个白名单；通用 {{path}} 绑定表达式仍禁函数调用；Schema 里不出现函数实现，全程不用 eval / new Function。",
];

export const CALCULATION_RECIPES: readonly CalculationRecipe[] = [
  { scene: "单价 × 数量", operands: "A=单价、B=数量", formula: "A * B" },
  { scene: "多明细金额合计", operands: "C=明细金额，aggregate=sum；precision=2", formula: "ROUND(C, 2)" },
  { scene: "含税总价", operands: "A=小计、B=税率", formula: "ROUND(A * (1 + B), 2)" },
  { scene: "满减折扣", operands: "A=金额", formula: "IF(A >= 1000, A * 0.8, A)" },
  { scene: "取最低报价", operands: "C=报价明细，aggregate=min", formula: "C" },
  { scene: "明细平均评分", operands: "C=评分，aggregate=avg；precision=1", formula: "ROUND(C, 1)" },
  {
    scene: "拼接展示文案",
    operands: "A=数量；output=text",
    formula: "CONCAT('共 ', COUNT(A), ' 项，合计 ', SUM(A), ' 元')",
  },
  { scene: "输入框字符串数字相加", operands: "A=单价(文本)、B=数量(文本)", formula: "A + B（数值优先；拼接用 CONCAT）" },
  { scene: "明细姓名逐行拼一段", operands: "C=姓名明细，aggregate=text", formula: "C（各非空行用换行拼接）" },
  { scene: "金额格式化展示", operands: "A=金额；output=text", formula: "TEXT(A, '#,##0.00')" },
  { scene: "除零兜底", operands: "A=金额、B=数量", formula: "IFERROR(A / B, 0)" },
  { scene: "空值兜底", operands: "A=可选值", formula: "COALESCE(A, 0)（或勾选「空值按 0 参与」）" },
  {
    scene: "仅在启用时计算",
    operands: "任意",
    formula: "when: { mode: 'and', rows: [{ left: 'form.enabled', operator: 'eq', value: 'yes' }] }",
  },
];

export const CALCULATION_TROUBLESHOOTING: readonly CalculationTroubleshooting[] = [
  {
    symptom: "保存时报「不支持函数调用 XXX」",
    cause: "函数名不在白名单，或把函数写进了 {{}} 绑定表达式",
    fix: "改用 30 个白名单函数之一；检查是否误写进绑定",
  },
  {
    symptom: "结果一直为空",
    cause: "参数个数不符 / 参数为非数值 / 有参与元素为空",
    fix: "看弹窗底部试算；勾选「空值按 0 参与」或使用 COALESCE",
  },
  {
    symptom: "结果不更新",
    cause: "参与条件 when 未命中；或目标元素没有绑定路径",
    fix: "检查条件行；文字元素保存时会自动补 textProp 绑定",
  },
  {
    symptom: "结果闪烁两轮才稳定",
    cause: "计算节点链式依赖（B 引用 A 的结果）靠下一轮响应式刷新收敛",
    fix: "属当前设计；如需单轮收敛要做拓扑排序（开放项）",
  },
  {
    symptom: "小数位不对",
    cause: "ROUND 与 precision 重复取舍",
    fix: "二选一",
  },
  {
    symptom: "静态 HTML 里没有计算值",
    cause: "静态导出不含运行时重算",
    fix: "需要时先导出运行态数据再固化",
  },
  {
    symptom: "别名报「保留字」或「重复」",
    cause: "用了 form / data / 函数名，或两行同名",
    fix: "改成 A / B / price 这类唯一变量名",
  },
];
