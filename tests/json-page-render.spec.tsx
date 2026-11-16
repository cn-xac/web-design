// @vitest-environment jsdom
/**
 * 数据驱动容器端到端（rGjzDs）：外部数据源写 scope → 容器读业务 JSON →
 * 推导成页面 → 表单控件回填 / 校验 / 导出。Vue 与 React 双端一致。
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import type { Component } from "vue";
import { renderToStaticMarkup } from "react-dom/server";
import { SchemaRenderer as VueRenderer } from "@x-ac/web-design-vue";
import { SchemaRenderer as ReactRenderer, nativeAdapter } from "@x-ac/web-design-react";
import { MATERIALS, type PageSchema, type UiAdapter } from "@x-ac/web-design-core";

/** 最小 Vue adapter：把常用物料映射到原生元素，materials 用 core 清单以保留 isFormControl 元数据 */
const NativeInput = defineComponent({
  props: { modelValue: { default: undefined }, label: String },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        value: props.modelValue ?? "",
        "data-label": props.label ?? "",
        onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
        ...attrs,
      });
  },
});
const Box = defineComponent({ setup: (_p, { slots }) => () => h("div", { class: "box" }, slots.default?.()) });
const vueAdapter: UiAdapter<Component> = {
  name: "test-native",
  materials: MATERIALS,
  components: {
    "ec-container": Box,
    "ec-input": NativeInput,
    "ec-number": NativeInput,
    "ec-select": NativeInput,
    "ec-date": NativeInput,
    "ec-text": defineComponent({ props: { text: String }, setup: (p) => () => h("span", String(p.text ?? "")) }),
    "ec-tag": defineComponent({ props: { text: String }, setup: (p) => () => h("span", String(p.text ?? "")) }),
    "ec-switch": NativeInput,
    "ec-subform": Box,
  },
};

/** 模拟外部数据源把响应写进 scope.form.detail 后的页面状态 */
const state = {
  form: {
    detail: {
      name: "张三",
      age: 18,
      email: "bad-email",
      items: [{ sku: "S1", qty: 2 }],
    },
  },
};

function dataDrivenPage(): PageSchema {
  return {
    schemaVersion: "1.3.0",
    id: "p_json_page",
    type: "page",
    meta: { title: "数据驱动容器", device: "pc" },
    state: JSON.parse(JSON.stringify(state)),
    children: [
      {
        id: "c1",
        component: "container",
        props: { contentPath: "form.detail", contentMode: "form" },
      },
    ],
  };
}

describe("Vue 渲染器：数据驱动容器", () => {
  it("业务 JSON 推导成表单控件并回填初值", () => {
    const wrapper = mount(VueRenderer, { props: { page: dataDrivenPage(), adapter: vueAdapter } });
    const html = wrapper.html();
    // 推导出的 input 绑定 form.detail.name，回填值应出现在 DOM
    expect(html).toContain("张三");
    expect(html).toContain("S1");
    // 推导节点 id 以 jp_ 开头，不写进真实 schema
    const page = wrapper.props("page") as PageSchema;
    expect(page.children[0].children).toBeUndefined();
  });

  it("validate() 覆盖推导字段：email 格式错误被拦截", () => {
    const wrapper = mount(VueRenderer, { props: { page: dataDrivenPage(), adapter: vueAdapter } });
    const valid = (wrapper.vm as unknown as { validate: () => boolean }).validate();
    expect(valid).toBe(false);
    const errors = (wrapper.vm as unknown as { getErrors: () => Record<string, string> }).getErrors();
    expect(Object.values(errors).some((msg) => /邮箱|email/i.test(msg))).toBe(true);
  });

  it("getData() 导出 scope 里的业务数据", () => {
    const wrapper = mount(VueRenderer, { props: { page: dataDrivenPage(), adapter: vueAdapter } });
    const result = (wrapper.vm as unknown as { getData: () => { data: Record<string, unknown> } }).getData();
    expect((result.data as typeof state).form.detail.name).toBe("张三");
  });

  it("修改推导出的表单控件后写回 scope，getData 带出新值", async () => {
    const wrapper = mount(VueRenderer, { props: { page: dataDrivenPage(), adapter: vueAdapter } });
    const inputs = wrapper.findAll("input");
    // 推导顺序中 name 是第一个可编辑字段（email 规则错误不影响初值回填）
    expect(inputs.length).toBeGreaterThan(0);
    await inputs[0].setValue("李四");

    const result = (wrapper.vm as unknown as { getData: () => { data: Record<string, unknown> } }).getData();
    expect((result.data as typeof state).form.detail.name).toBe("李四");
  });
});

describe("React 渲染器：数据驱动容器（SSR 冒烟）", () => {
  it("同一份 state 推导出表单控件，输出与 Vue 语义一致", () => {
    const html = renderToStaticMarkup(<ReactRenderer page={dataDrivenPage()} ui={nativeAdapter} />);
    expect(html).toContain("张三");
    expect(html).toContain("S1");
  });
});
