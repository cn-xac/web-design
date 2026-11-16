// @vitest-environment jsdom
/**
 * React 渲染层：外部数据源触发型取数的防抖与 once 行为。
 * 与 external-trigger-vue.spec.ts 一一对应，保证两端不漂移。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { SchemaRenderer, nativeAdapter } from "@x-ac/web-design-react";
import type { SchemaRendererHandle } from "@x-ac/web-design-react";
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
    id: "page_trigger_react",
    type: "page",
    state: { form: { n_kw: "" } },
    externalSources: { [source.id]: source },
    children: [{ id: "n_kw", component: "input", props: {}, externalRef: source.id }],
  };
}

let calls: string[];
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function mountPage(p: PageSchema): Promise<SchemaRendererHandle> {
  const ref = createRef<SchemaRendererHandle>();
  await act(async () => {
    root.render(<SchemaRenderer ref={ref} page={p} ui={nativeAdapter} />);
  });
  return ref.current!;
}

async function setKw(ref: SchemaRendererHandle, value: string): Promise<void> {
  await act(async () => {
    ref.setData({ form: { n_kw: value } });
  });
}

describe("React 渲染层：触发型外部数据源防抖", () => {
  it("逐字输入合并为末次一次请求", async () => {
    const ref = await mountPage(page(src()));
    await sleep(10);

    await setKw(ref, "张");
    await sleep(5);
    await setKw(ref, "张三");
    await sleep(5);
    await setKw(ref, "张三丰");
    await sleep(80);

    expect(calls.length).toBe(1);
  });

  it("once=false：停顿后每次新值都真请求", async () => {
    const ref = await mountPage(page(src({ once: false })));
    await sleep(10);

    await setKw(ref, "张");
    await sleep(60);
    await setKw(ref, "李四");
    await sleep(60);

    expect(calls.length).toBe(2);
  });

  it("清空后重输同一关键词能再次请求", async () => {
    const ref = await mountPage(page(src({ once: false })));
    await sleep(10);

    await setKw(ref, "张");
    await sleep(60);
    await setKw(ref, "");
    await sleep(10);
    await setKw(ref, "张");
    await sleep(60);

    expect(calls.length).toBe(2);
  });
});
