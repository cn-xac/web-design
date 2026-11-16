# @x-ac/web-design-core

框架无关的可视化搭建内核。**不依赖 Vue / React / Element Plus，也不访问 window**，可以在浏览器、Node、SSR、单测里同样运行。

同一份 `PageSchema` 交给 `@x-ac/web-design-vue` 或 `@x-ac/web-design-react` 渲染，结果一致；数据校验与导出也只在这里实现一次。

## 安装

```bash
pnpm add @x-ac/web-design-core
```

## PageSchema 速览

```ts
import type { PageSchema } from "@x-ac/web-design-core";

const page: PageSchema = {
  schemaVersion: "1.2.0",
  id: "page_employee",
  type: "page",
  meta: { title: "员工登记", device: "pc" },
  state: { form: { name: "", mobile: "" } },
  children: [
    {
      id: "n_name",
      component: "input",
      props: { label: "姓名", modelValue: "{{form.name}}" },
      rules: [{ type: "required" }, { type: "maxLength", value: 20 }],
    },
    {
      id: "n_mobile",
      component: "input",
      props: { label: "手机号", modelValue: "{{form.mobile}}" },
      rules: [{ type: "required" }, { type: "phone" }],
    },
  ],
};
```

## 校验规则

规则挂在节点上（`node.rules`），是纯数据，JSON 里不出现任何可执行代码。

| type | 说明 | value |
|---|---|---|
| `required` | 必填（空串 / 空白 / 空数组都算空） | 无 |
| `minLength` / `maxLength` | 最短 / 最长字符数，emoji 按码点算 | 数字 |
| `min` / `max` | 数值范围 | 数字 |
| `pattern` | 自定义正则，`flags` 支持 `imsu` | 正则源码 |
| `email` / `phone` | 内置格式（手机号为中国大陆 11 位） | 无 |
| `integer` | 必须为整数 | 无 |

通用字段：`message` 自定义文案（支持 `{label}` / `{value}` 占位）、`when` 条件表达式。

```ts
// 只有「企业类型」才要求填公司名称
{ type: "required", when: "form.type === 'company'" }
```

## API

```ts
import {
  validateData,        // 整页校验
  validateNodeField,   // 单字段校验（失焦用）
  describeField,       // 把一个节点描述成可校验字段
  exportData,          // 收集表单数据 + 校验
  toDataJSON,          // 序列化成 JSON 文本
  toHtml,              // 导出静态 HTML
} from "@x-ac/web-design-core";

// 1. 校验
const errors: Record<string, string> = {};   // nodeId -> 文案
const result = validateData(page, scope, { errors });
// { valid, errors: [{ nodeId, path, label, rule, message }], byNode, checkedFields, checkedRules }

// 2. 导出数据
const data = exportData(page, scope);
// { valid, data: { form: {...} }, flat: { "form.name": "..." }, fields, unbound, errors, exportedAt }
console.log(toDataJSON(data, { includeMeta: true }));
```

`exportData` 默认不导出空值（`includeEmpty: true` 可保留），并按绑定路径还原嵌套结构；`flat` 是同一份数据的扁平视图，方便直接丢给接口或表格。

## 数据计算与高级函数（1.2.0 起）

文字 / 数字元素可以选参与元素、写算式，运行时自动把结果回填到自己的绑定路径：

```ts
import { applyCalculations, CALCULATION_FUNCTIONS } from "@x-ac/web-design-core";

// page.children 里某个节点带 calculation：
// { operands: [{ alias: "A", path: "form.price" }, { alias: "B", path: "form.qty" }],
//   formula: "ROUND(SUM(A * B, C), 2)" }
const results = applyCalculations(page, scope);
// [{ nodeId, path, value, changed, skipped }]；值不变则 changed=false（幂等）
console.log(CALCULATION_FUNCTIONS.map((fn) => fn.name));
// SUM AVG MIN MAX COUNT PRODUCT ROUND CEIL FLOOR ABS POWER SQRT MOD IF CONCAT LEN COALESCE ISBLANK
```

- 安全：通用 `{{path}}` 绑定表达式**仍禁函数调用**；只有计算模块通过 `evaluateWithFunctions()` 显式注入静态白名单函数表时才允许调用，函数名只是协议符号。
- 子表单：明细字段路径用 `[0]` 占位，指定 `sum`/`avg`/`min`/`max` 按全部行聚合；子表单内目标逐行回填。
- 参与条件复用 `ConditionGroup` / `evaluateConditionGroup`；保存前用 `validateCalculationConfig()` 校验别名、算式与聚合口径。
- 每个函数在 `CALCULATION_FUNCTIONS` 里都带 `params` / `returns` / `example` 元数据，设计器弹窗悬停函数名即可查看；标题右侧「?」打开完整说明弹窗，内容还包括 `calculation/usage.ts` 的 `CALCULATION_USAGE_NOTES` / `CALCULATION_RECIPES` / `CALCULATION_TROUBLESHOOTING`（与手册同源）。完整手册见容器根 `docs/CALCULATION_FUNCTIONS.md`。

## 其他能力

- `expression.ts`：自研 tokenizer + Pratt parser，禁用 `eval` 与原型链逃逸；默认禁函数调用，白名单函数仅经 `evaluateWithFunctions()` 注入
- `calculation/`：数据计算契约、30 个高级函数白名单、数值优先混编求值、算式点击构建纯函数与设计期目标清单
- `tree.ts`：节点增删改移、面包屑、按新 id 克隆
- `style/`：通用 margin / padding（四边相等收敛成简写）+ 组件契约样式
- `actions/`：8 个声明式动作，副作用通过 `ActionAdapter` 注入
- `serialize.ts`：默认值不落库的压缩序列化

## License

MIT
