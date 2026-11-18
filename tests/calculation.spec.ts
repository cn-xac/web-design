/**
 * 数据计算（rtHicl）内核用例：受限表达式函数调用、高级函数白名单、
 * 子表单聚合、参与条件、自动回填与协议校验。纯函数，无需挂载框架。
 */
import { describe, expect, it } from "vitest";
import {
  CALCULATION_AGGREGATES,
  CALCULATION_FUNCTIONS,
  CALCULATION_FUNCTION_MAP,
  CALCULATION_RECIPES,
  CALCULATION_TROUBLESHOOTING,
  CALCULATION_USAGE_NOTES,
  FORMULA_OPERATOR_BUTTONS,
  SCHEMA_VERSION,
  aggregateSeries,
  applyCalculations,
  buildFunctionCall,
  canOwnCalculation,
  collectCalculationTargets,
  collectSpecialSettings,
  compactNode,
  evaluate,
  evaluateCalculation,
  evaluateWithFunctions,
  functionArgSlots,
  insertFormulaToken,
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
  it("30 个函数全部有签名、参数、返回、示例与说明，且分组齐全", () => {
    expect(CALCULATION_FUNCTIONS).toHaveLength(30);
    expect(new Set(CALCULATION_FUNCTIONS.map((fn) => fn.group))).toEqual(
      new Set(["聚合", "数学", "逻辑与文本", "日期"]),
    );
    // 设计器的函数说明卡与手册都以这份元数据为唯一来源
    expect(
      CALCULATION_FUNCTIONS.every(
        (fn) => fn.signature && fn.description && fn.params && fn.returns && fn.example,
      ),
    ).toBe(true);
    expect(CALCULATION_FUNCTIONS.filter((fn) => fn.group === "聚合")).toHaveLength(6);
    expect(CALCULATION_FUNCTIONS.filter((fn) => fn.group === "数学")).toHaveLength(9);
    expect(CALCULATION_FUNCTIONS.filter((fn) => fn.group === "逻辑与文本")).toHaveLength(13);
    expect(CALCULATION_FUNCTIONS.filter((fn) => fn.group === "日期")).toHaveLength(2);
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

describe("高级函数使用说明常量（弹窗与手册同源）", () => {
  it("通用规则、业务配方、排错表齐全且字段完整", () => {
    expect(CALCULATION_USAGE_NOTES.length).toBeGreaterThanOrEqual(8);
    expect(CALCULATION_RECIPES.length).toBeGreaterThanOrEqual(8);
    expect(CALCULATION_TROUBLESHOOTING.length).toBeGreaterThanOrEqual(6);
    expect(CALCULATION_RECIPES.every((item) => item.scene && item.operands && item.formula)).toBe(true);
    expect(CALCULATION_TROUBLESHOOTING.every((item) => item.symptom && item.cause && item.fix)).toBe(true);
    expect(CALCULATION_USAGE_NOTES.every((note) => note.length > 10)).toBe(true);
  });
});

describe("特殊设置清单（组件树）", () => {
  it("带高级计算的节点被收录，并给出元素标签与绑定路径", () => {
    const page: PageSchema = {
      schemaVersion: SCHEMA_VERSION,
      id: "p_special",
      type: "page",
      children: [
        { id: "n_total", component: "text", props: { label: "合计", text: "{{form.n_total}}" }, calculation: config() },
        { id: "n_plain", component: "input" },
        {
          id: "grp",
          component: "ec-subform",
          props: { itemPath: "items" },
          children: [{ id: "n_line", component: "number", calculation: config() }],
        },
      ],
    };
    const items = collectSpecialSettings(page);
    expect(items.map((item) => item.nodeId)).toEqual(["n_total", "n_line"]);
    expect(items[0]).toMatchObject({
      title: "文本",
      elementLabel: "合计",
      path: "form.n_total",
    });
    expect(items[0].flags.calculation).toBe(true);
    expect(items[0].flags.external).toBe(false);
    // 子表单内的条目也带上 [0] 占位，与运行时路径一致
    expect(items[1].path).toBe("form.items[0].n_line");
  });

  it("元素标签兼容取值：按钮取内容、表单控件取 Label、没有 Label 置空", () => {
    const page: PageSchema = {
      schemaVersion: SCHEMA_VERSION,
      id: "p_label",
      type: "page",
      children: [
        { id: "b1", component: "button", props: { text: "提交" }, events: { click: [{ action: "toast" }] } },
        { id: "i1", component: "input", props: { label: "姓名" }, rules: [{ type: "required" }] },
        { id: "i2", component: "input", rules: [{ type: "required" }] },
        {
          id: "t1",
          component: "text",
          props: { label: "合计" },
          visibility: { show: { mode: "and", rows: [] } },
        },
        {
          id: "x1",
          component: "biz-unknown",
          props: { title: "自定义区块" },
          events: { click: [{ action: "toast" }] },
        },
      ],
    };
    const byId = (id: string) => collectSpecialSettings(page).find((item) => item.nodeId === id);
    expect(byId("b1")?.elementLabel).toBe("提交");
    expect(byId("i1")?.elementLabel).toBe("姓名");
    expect(byId("i2")?.elementLabel).toBe("");
    expect(byId("t1")?.elementLabel).toBe("合计");
    // 未登记物料按常见键兼容，不会因为缺元数据就全空
    expect(byId("x1")?.elementLabel).toBe("自定义区块");
    expect(byId("i1")?.label).toContain("姓名");
    expect(byId("i2")?.label).not.toContain(" · ");
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
    ).toContain("参与元素 1 的聚合口径只支持 sum / avg / min / max / text");
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

  it("1.1.0 起链式迁移到当前版本，只推进版本号并保留 calculation", () => {
    const old = { ...pageWith(config()), schemaVersion: "1.1.0" };
    const { schema, applied } = migratePage(old);
    expect(schema.schemaVersion).toBe(SCHEMA_VERSION);
    expect(applied).toEqual(["1.1.0 -> 1.2.0", "1.2.0 -> 1.3.0"]);
    expect(schema.children[2].calculation).toEqual(config());
    expect(SCHEMA_VERSION).toBe("1.3.0");
  });

  it("文字 / 数字 / 选项类控件都能承载计算，目标清单能拿到回填路径", () => {
    expect(canOwnCalculation({ id: "t1", component: "ec-text" })).toBe(true);
    expect(canOwnCalculation({ id: "t2", component: "ec-number" })).toBe(true);
    // 选项 / 下拉 / 单选等「值可自定义」的控件也能作为计算回填目标
    expect(canOwnCalculation({ id: "t4", component: "select" })).toBe(true);
    expect(canOwnCalculation({ id: "t5", component: "radio" })).toBe(true);
    expect(canOwnCalculation({ id: "t6", component: "checkbox" })).toBe(true);
    expect(canOwnCalculation({ id: "t3", component: "ec-container" })).toBe(false);
    const targets = collectCalculationTargets(pageWith(config()));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ nodeId: "n_total", path: "form.n_total" });
  });
});

describe("数值优先的混编运算（仅计算通道）", () => {
  const run = (expression: string) => evaluateWithFunctions(expression, {}, CALCULATION_FUNCTION_MAP);

  it("纯数字字符串参与算术时按数值处理", () => {
    expect(run("'12' + 3")).toBe(15);
    expect(run("'12' - 3")).toBe(9);
    expect(run("'12' * '3'")).toBe(36);
    expect(run("'12' / '4'")).toBe(3);
    expect(run("'7' % '4'")).toBe(3);
    expect(run("-'12'")).toBe(-12);
    expect(run("+'12'")).toBe(12);
  });

  it("比较运算优先按数值比", () => {
    expect(run("'12' > 3")).toBe(true);
    expect(run("'2' > 10")).toBe(false);
    expect(run("'12' >= 12")).toBe(true);
    expect(run("'3' <= '3'")).toBe(true);
  });

  it("转不成数值时 + 回落拼接，其它算术返回空", () => {
    expect(run("'abc' + 3")).toBe("abc3");
    expect(run("'abc' * 3")).toBeUndefined();
    expect(run("'' + 3")).toBe("3");
  });

  it("参与元素来自输入框的字符串数字也能相加", () => {
    const page = pageWith(config({ formula: "A + B" }));
    const scope = { form: { n_price: "12", n_qty: "3", n_total: 0 } };
    expect(applyCalculations(page, scope)[0].value).toBe(15);
  });

  it("通用 {{}} 表达式保持原严格语义，不受计算通道影响", () => {
    expect(evaluate("'12' + 3")).toBe("123");
    expect(evaluate("'12' * 3")).toBeUndefined();
  });
});

describe("子表单文本聚合", () => {
  const scope = {
    form: {
      rows: [{ name: "张三" }, { name: "李四" }, { name: "" }, { name: "王五" }],
    },
  };

  it("聚合口径清单含文本", () => {
    expect(CALCULATION_AGGREGATES.some((option) => option.value === "text")).toBe(true);
  });

  it("按行拼接非空值，默认换行分隔", () => {
    expect(aggregateSeries(["张三", "李四", "", "王五"], "text")).toBe("张三\n李四\n王五");
    expect(aggregateSeries(["单个"], "text")).toBe("单个");
  });

  it("计算配置可用 text 聚合子表单列", () => {
    const operand = { alias: "A", path: "form.rows[0].name", aggregate: "text" as const };
    const outcome = evaluateCalculation(config({ operands: [operand], formula: "A" }), scope, 0);
    expect(outcome.value).toBe("张三\n李四\n王五");
  });
});

describe("新增 Excel 常用函数", () => {
  const run = (expression: string) => evaluateWithFunctions(expression, {}, CALCULATION_FUNCTION_MAP);

  it("定向舍入、错误兜底与格式文本", () => {
    expect(run("ROUNDUP(1.21, 1)")).toBe(1.3);
    expect(run("ROUNDUP(-1.21, 1)")).toBe(-1.3);
    expect(run("ROUNDDOWN(1.29, 1)")).toBe(1.2);
    expect(run("ROUNDDOWN(-1.29, 1)")).toBe(-1.2);
    expect(run("IFERROR(1 / 0, 0)")).toBe(0);
    expect(run("IFERROR(3, 0)")).toBe(3);
    expect(run("TEXT(12.5, '0.00')")).toBe("12.50");
    expect(run("TEXT(1234567.891, '#,##0.00')")).toBe("1,234,567.89");
    expect(run("TEXT(0.125, '0.0%')")).toBe("12.5%");
  });

  it("文本截取与清理", () => {
    expect(run("LEFT('abcdef', 2)")).toBe("ab");
    expect(run("RIGHT('abcdef', 2)")).toBe("ef");
    expect(run("MID('abcdef', 2, 3)")).toBe("bcd");
    expect(run("TRIM('  a   b ')")).toBe("a b");
    expect(run("UPPER('abc')")).toBe("ABC");
    expect(run("LOWER('ABC')")).toBe("abc");
  });

  it("日期函数返回可解析文本，并能再格式化", () => {
    const today = run("TODAY()") as string;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(run("NOW()")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(run(`TEXT('${today}', 'yyyy年m月d日')`)).toBe(
      `${Number(today.slice(0, 4))}年${Number(today.slice(5, 7))}月${Number(today.slice(8, 10))}日`,
    );
  });
});

describe("算式点击构建纯函数", () => {
  it("运算符插入自动补空格，已有空格不重复", () => {
    expect(insertFormulaToken("A", "+", 1)).toEqual({ formula: "A + ", cursor: 4 });
    expect(insertFormulaToken("A + ", "B", 4)).toEqual({ formula: "A + B", cursor: 5 });
    expect(insertFormulaToken("A ", "+", 2)).toEqual({ formula: "A + ", cursor: 4 });
    expect(insertFormulaToken("A", "(", 1)).toEqual({ formula: "A(", cursor: 2 });
  });

  it("选中文本时插入会替换选区", () => {
    expect(insertFormulaToken("A + B", "C", 4, 5)).toEqual({ formula: "A + C", cursor: 5 });
  });

  it("参数槽来自统一提示表，拼成合法调用", () => {
    const round = CALCULATION_FUNCTIONS.find((fn) => fn.name === "ROUND")!;
    expect(functionArgSlots(round).map((slot) => slot.default)).toEqual([undefined, "2"]);
    expect(buildFunctionCall("round", ["A", "2"])).toBe("ROUND(A, 2)");
    const today = CALCULATION_FUNCTIONS.find((fn) => fn.name === "TODAY")!;
    expect(functionArgSlots(today)).toEqual([]);
    expect(buildFunctionCall("TODAY", [])).toBe("TODAY()");
  });

  it("运算符按钮覆盖常用运算", () => {
    const values = FORMULA_OPERATOR_BUTTONS.map((button) => button.value);
    expect(values).toEqual(expect.arrayContaining(["+", "-", "*", "/", "%", "(", ")", ",", "?", ":"]));
    expect(validateCalculationFormula("A + B * 2 > 3 && C")).toBeNull();
  });
});
