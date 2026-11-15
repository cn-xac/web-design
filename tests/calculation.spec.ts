/**
 * 数据计算（rtHicl）内核用例：受限表达式函数调用、高级函数白名单、
 * 子表单聚合、参与条件、自动回填与协议校验。纯函数，无需挂载框架。
 */
import { describe, expect, it } from "vitest";
import {
  CALCULATION_FUNCTIONS,
  CALCULATION_FUNCTION_MAP,
  SCHEMA_VERSION,
  applyCalculations,
  canOwnCalculation,
  collectCalculationTargets,
  compactNode,
  evaluate,
  evaluateCalculation,
  evaluateWithFunctions,
  migratePage,
  toJSON,
  validateCalculationConfig,
  validateCalculationFormula,
  validateExpression,
  validatePage,
  type CalculationConfig,
  type NodeSchema,
  type PageSchema,
} from "@x-ac/web-design-core";

const numberNode = (id: string, label = id): NodeSchema => ({
  id,
  component: "ec-number",
  props: { label },
});

const config = (patch: Partial<CalculationConfig> = {}): CalculationConfig => ({
  operands: [
    { alias: "A", path: "form.n_price" },
    { alias: "B", path: "form.n_qty" },
  ],
  formula: "A * B",
  ...patch,
});

const pageWith = (calculation: CalculationConfig | undefined, children?: NodeSchema[]): PageSchema => ({
  schemaVersion: SCHEMA_VERSION,
  id: "page_calc",
  type: "page",
  state: { form: { n_price: 10, n_qty: 2 } },
  children: children ?? [
    numberNode("n_price"),
    numberNode("n_qty"),
    { ...numberNode("n_total", "合计"), ...(calculation ? { calculation } : {}) },
  ],
});

describe("受限表达式：只有显式注入白名单才允许函数调用", () => {
  it("通用 evaluate 仍然拒绝函数调用（红线不破）", () => {
    expect(evaluate("SUM(1, 2)", {})).toBeUndefined();
    expect(validateExpression("SUM(1, 2)")).toContain("不支持函数调用");
  });

  it("白名单函数名大小写不敏感，未注册函数仍被拒绝", () => {
    expect(evaluateWithFunctions("SUM(1, 2)", {}, CALCULATION_FUNCTION_MAP)).toBe(3);
    expect(evaluateWithFunctions("sum(1, 2)", {}, CALCULATION_FUNCTION_MAP)).toBe(3);
    expect(validateExpression("EVIL(1)", CALCULATION_FUNCTION_MAP)).toContain("不支持函数调用");
    expect(evaluateWithFunctions("EVIL(1)", {}, CALCULATION_FUNCTION_MAP)).toBeUndefined();
  });

  it("scope 里伪装成函数的构造器不会被调用", () => {
    const scope = { SUM: () => 999 };
    expect(evaluateWithFunctions("SUM(1, 2)", scope, {})).toBeUndefined();
    expect(evaluateWithFunctions("ROUND(1.234, 2)", {}, CALCULATION_FUNCTION_MAP)).toBe(1.23);
  });

  it("函数可与普通运算、比较、三元、路径组合", () => {
    const scope = { form: { amount: 3 } };
    expect(evaluateWithFunctions("ROUND(SUM(form.amount, 2) * 1.5, 1)", scope, CALCULATION_FUNCTION_MAP)).toBe(7.5);
    expect(evaluateWithFunctions("IF(form.amount > 2, MAX(1, 9), 0)", scope, CALCULATION_FUNCTION_MAP)).toBe(9);
  });
});

describe("高级函数白名单", () => {
  it("18 个函数全部有签名、参数、返回、示例与说明，且分组齐全", () => {
    expect(CALCULATION_FUNCTIONS).toHaveLength(18);
    expect(new Set(CALCULATION_FUNCTIONS.map((fn) => fn.group))).toEqual(
      new Set(["聚合", "数学", "逻辑与文本"]),
    );
    // 设计器的函数说明卡与手册都以这份元数据为唯一来源
    expect(
      CALCULATION_FUNCTIONS.every(
        (fn) => fn.signature && fn.description && fn.params && fn.returns && fn.example,
      ),
    ).toBe(true);
    expect(CALCULATION_FUNCTIONS.filter((fn) => fn.group === "聚合")).toHaveLength(6);
    expect(CALCULATION_FUNCTIONS.filter((fn) => fn.group === "数学")).toHaveLength(7);
    expect(CALCULATION_FUNCTIONS.filter((fn) => fn.group === "逻辑与文本")).toHaveLength(5);
  });

  it("聚合 / 数学函数结果正确，数组会展开", () => {
    const run = (expression: string) => evaluateWithFunctions(expression, {}, CALCULATION_FUNCTION_MAP);
    expect(run("SUM(1, 2, 3)")).toBe(6);
    expect(run("AVG(2, 4, 6)")).toBe(4);
    expect(run("MIN(3, 1, 2)")).toBe(1);
    expect(run("MAX(3, 1, 2)")).toBe(3);
    expect(run("COUNT(0, '', 2)")).toBe(2);
    expect(run("PRODUCT(2, 3, 4)")).toBe(24);
    expect(run("CEIL(1.2)")).toBe(2);
    expect(run("FLOOR(1.8)")).toBe(1);
    expect(run("ABS(-3)")).toBe(3);
    expect(run("POWER(2, 3)")).toBe(8);
    expect(run("SQRT(9)")).toBe(3);
    expect(run("MOD(7, 4)")).toBe(3);
    // Schema 里不写数组字面量（表达式层不支持），数组由参与元素 / 作用域传入
    expect(evaluateWithFunctions("SUM(list, 3)", { list: [1, 2] }, CALCULATION_FUNCTION_MAP)).toBe(6);
  });

  it("参数个数不合法或除零时返回空值，不抛错", () => {
    const run = (expression: string) => evaluateWithFunctions(expression, {}, CALCULATION_FUNCTION_MAP);
    expect(run("ROUND(1.2, 2, 3)")).toBeUndefined();
    expect(run("POWER(2)")).toBeUndefined();
    expect(run("MOD(1, 0)")).toBeUndefined();
    expect(run("SQRT(-1)")).toBeUndefined();
  });

  it("逻辑与文本函数可用", () => {
    const run = (expression: string) => evaluateWithFunctions(expression, {}, CALCULATION_FUNCTION_MAP);
    expect(run("IF(1 > 0, '有', '无')")).toBe("有");
    expect(run("CONCAT('合计:', 12)")).toBe("合计:12");
    expect(run("LEN('abcd')")).toBe(4);
    expect(run("COALESCE('', 0, 5)")).toBe(0);
    expect(run("ISBLANK('')")).toBe(true);
  });
});

describe("计算求值", () => {
  it("按别名取参与元素，算出结果并写回目标路径", () => {
    const scope = { form: { n_price: 10, n_qty: 2, n_total: 0 } };
    const results = applyCalculations(pageWith(config()), scope);
    expect(results[0]).toMatchObject({ nodeId: "n_total", path: "form.n_total", value: 20, changed: true });
    expect(scope.form.n_total).toBe(20);
  });

  it("重复执行幂等：值没变就不再写", () => {
    const scope = { form: { n_price: 10, n_qty: 2, n_total: 0 } };
    applyCalculations(pageWith(config()), scope);
    const again = applyCalculations(pageWith(config()), scope);
    expect(again[0].changed).toBe(false);
  });

  it("子表单明细字段聚合成单值（sum / avg / min / max）", () => {
    const scope = { form: { items: [{ qty: 2 }, { qty: 4 }, { qty: 6 }] } };
    const child = (aggregate: "sum" | "avg" | "min" | "max"): CalculationConfig => ({
      operands: [{ alias: "A", path: "form.items[0].qty", aggregate }],
      formula: "A",
    });
    expect(evaluateCalculation(child("sum"), scope, 0).value).toBe(12);
    expect(evaluateCalculation(child("avg"), scope, 0).value).toBe(4);
    expect(evaluateCalculation(child("min"), scope, 0).value).toBe(2);
    expect(evaluateCalculation(child("max"), scope, 0).value).toBe(6);
  });

  it("子表单内目标按行逐行回填，不串值", () => {
    const scope = {
      form: {
        items: [
          { n_qty: 2, n_price: 3 },
          { n_qty: 4, n_price: 5 },
        ],
      },
    };
    const page: PageSchema = {
      schemaVersion: SCHEMA_VERSION,
      id: "page_sub",
      type: "page",
      children: [
        {
          id: "g1",
          component: "ec-subform",
          props: { itemPath: "items" },
          children: [
            numberNode("n_qty"),
            numberNode("n_price"),
            {
              ...numberNode("n_line", "小计"),
              calculation: {
                operands: [
                  { alias: "A", path: "form.items[0].n_qty" },
                  { alias: "B", path: "form.items[0].n_price" },
                ],
                formula: "A * B",
              },
            },
          ],
        },
      ],
    };
    const results = applyCalculations(page, scope);
    expect(results.map((item) => item.path)).toEqual(["form.items[0].n_line", "form.items[1].n_line"]);
    expect(results.map((item) => item.value)).toEqual([6, 20]);
  });

  it("参与条件复用 ConditionGroup：未命中则不写回", () => {
    const scope = { form: { n_price: 10, n_qty: 2, flag: "no" } };
    const result = applyCalculations(
      pageWith(
        config({
          when: { mode: "and", rows: [{ left: "form.flag", operator: "eq", value: "yes" }] },
        }),
      ),
      scope,
    );
    expect(result[0].skipped).toBe(true);
    expect(scope.form.n_total).toBeUndefined();
  });

  it("空值默认清空结果，emptyAsZero 按 0 参与", () => {
    const scope = { form: { n_price: 10, n_qty: "" } };
    expect(evaluateCalculation(config(), scope).value).toBe("");
    expect(evaluateCalculation(config({ emptyAsZero: true }), scope).value).toBe(0);
  });

  it("小数位与文本输出形态", () => {
    const scope = { form: { n_price: 10, n_qty: 3 } };
    expect(evaluateCalculation(config({ formula: "A / B", precision: 2 }), scope).value).toBe(3.33);
    expect(evaluateCalculation(config({ formula: "CONCAT('共', A * B, '元')", output: "text" }), scope).value).toBe(
      "共30元",
    );
  });

  it("ROUND 等高级函数与聚合口径可以叠加", () => {
    const scope = { form: { items: [{ qty: 1 }, { qty: 2 }] } };
    const value = evaluateCalculation(
      {
        operands: [{ alias: "A", path: "form.items[0].qty", aggregate: "avg" }],
        formula: "ROUND(SUM(A, 0.005), 2)",
      },
      scope,
    ).value;
    expect(value).toBe(1.51);
  });
});

describe("协议校验与落库", () => {
  it("算式语法、别名、聚合、小数位都有静态校验", () => {
    expect(validateCalculationFormula("ROUND(SUM(A, B), 2)")).toBeNull();
    expect(validateCalculationFormula("A + (B")).not.toBeNull();
    expect(validateCalculationConfig(config())).toEqual([]);
    expect(validateCalculationConfig(config({ operands: [] }))).toContain("至少选择一个参与元素");
    expect(
      validateCalculationConfig(
        config({ operands: [{ alias: "A", path: "form.a" }, { alias: "A", path: "form.b" }] }),
      ),
    ).toContain("参与元素 2 的别名 A 重复");
    expect(validateCalculationConfig(config({ precision: 20 }))).toContain("小数位必须是 0~10 的数字");
    expect(
      validateCalculationConfig(config({ operands: [{ alias: "A", path: "form.a", aggregate: "median" as "sum" }] })),
    ).toContain("参与元素 1 的聚合口径只支持 sum / avg / min / max");
    expect(
      validateCalculationConfig(config({ operands: [{ alias: "A", path: "form.n_total" }] }), "form.n_total"),
    ).toContain("参与元素 1 不能引用当前元素自身");
  });

  it("validatePage 会拦下非法计算配置", () => {
    const bad = pageWith(config({ formula: "A + (" }));
    const result = validatePage(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path.includes("calculation"))).toBe(true);
  });

  it("序列化保留 calculation，Schema 往返 diff 为空", () => {
    const page = pageWith(config());
    expect(compactNode(page.children[2]).calculation).toEqual(config());
    const first = toJSON(page);
    expect(toJSON(JSON.parse(first))).toBe(first);
  });

  it("1.1.0 → 1.2.0 迁移只推进版本号", () => {
    const old = { ...pageWith(config()), schemaVersion: "1.1.0" };
    const { schema, applied } = migratePage(old);
    expect(schema.schemaVersion).toBe("1.2.0");
    expect(applied).toEqual(["1.1.0 -> 1.2.0"]);
    expect(schema.children[2].calculation).toEqual(config());
    expect(SCHEMA_VERSION).toBe("1.2.0");
  });

  it("只有文字 / 数字元素能配置计算，目标清单能拿到回填路径", () => {
    expect(canOwnCalculation({ id: "t1", component: "ec-text" })).toBe(true);
    expect(canOwnCalculation({ id: "t2", component: "ec-number" })).toBe(true);
    expect(canOwnCalculation({ id: "t3", component: "ec-container" })).toBe(false);
    const targets = collectCalculationTargets(pageWith(config()));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ nodeId: "n_total", path: "form.n_total" });
  });
});
