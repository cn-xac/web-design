// @vitest-environment jsdom
/**
 * Vue 渲染层：外部数据源触发型取数的防抖与 once 行为。
 * 验证「输入就打接口」已改为「输入停止后防抖取数」，且 once=false 时每次有效触发都真请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { SchemaRenderer } from "@x-ac/web-design-vue";
import {
  createRequest,
  setDefaultRequest,
  SCHEMA_VERSION,
  type ExternalDataSource,
  type PageSchema,
} from "@x-ac/web-design-core";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function mockResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const src = (partial: Partial<ExternalDataSource> = {}): ExternalDataSource => ({
  id: "s1",
  url: "/api/search",
  triggerLength: 1,
  debounceMs: 20,
  listField: "list",
  responses: [{ scopePath: "options.n_kw", shape: "select" }],
  ...partial,
});

function page(source: ExternalDataSource): PageSchema {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "page_trigger_vue",
    type: "page",
    state: { form: { n_kw: "" } },
    externalSources: { [source.id]: source },
    children: [{ id: "n_kw", component: "input", props: {}, externalRef: source.id }],
  };
}

let calls: string[];

beforeEach(() => {
  calls = [];
  setDefaultRequest(
    createRequest({
      defaults: {
        fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return mockResponse({ list: [{ label: "结果", value: "1" }] });
        }),
      },
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("Vue 渲染层：触发型外部数据源防抖", () => {
  it("逐字输入合并为末次一次请求（原来是输入就请求）", async () => {
    const wrapper = mount(SchemaRenderer, {
      props: { page: page(src()), mode: "view" },
    });
    const scope = (wrapper.vm as unknown as { scope: Record<string, unknown> }).scope;
    const form = scope.form as Record<string, unknown>;
    await sleep(10);

    form.n_kw = "张";
    await sleep(5);
    form.n_kw = "张三";
    await sleep(5);
    form.n_kw = "张三丰";
    await sleep(80); // 超过防抖 20ms

    // 逐字输入只合并为末次一次请求；防抖前的实现每个字符都会各发一次（3 次）
    expect(calls.length).toBe(1);
    wrapper.unmount();
  });

  it("once=false：停顿后每次新值都真请求（不受页面级缓存吞掉）", async () => {
    const wrapper = mount(SchemaRenderer, {
      props: { page: page(src({ once: false })), mode: "view" },
    });
    const scope = (wrapper.vm as unknown as { scope: Record<string, unknown> }).scope;
    const form = scope.form as Record<string, unknown>;
    await sleep(10);

    form.n_kw = "张";
    await sleep(60);
    form.n_kw = "李四";
    await sleep(60);

    expect(calls.length).toBe(2);
    wrapper.unmount();
  });

  it("清空后重输同一关键词能再次请求", async () => {
    const wrapper = mount(SchemaRenderer, {
      props: { page: page(src({ once: false })), mode: "view" },
    });
    const scope = (wrapper.vm as unknown as { scope: Record<string, unknown> }).scope;
    const form = scope.form as Record<string, unknown>;
    await sleep(10);

    form.n_kw = "张";
    await sleep(60);
    form.n_kw = "";
    await sleep(10);
    form.n_kw = "张";
    await sleep(60);

    expect(calls.length).toBe(2);
    wrapper.unmount();
  });
});
