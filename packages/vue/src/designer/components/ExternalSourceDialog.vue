<script setup lang="ts">
/**
 * 外部数据源配置弹窗（rg4KCt / 本次增强）。
 *
 * 本次针对反馈的改造：
 * 1. 响应数据映射支持多条（仿参数映射，可增删），各自写不同 scope 路径（#4）；
 * 2. 映射目标可任选「任意元素」（含非表单元素，#1）—— 非表单元素的写入路径落在 data.<节点ID>；
 * 3. 响应映射整体可选：不配也能发请求（例如仅用于触发 / 写副作用，#2）；
 * 4. 触发由「数据源所在元素自身的值」或「额外选中的参数」驱动，不依赖绑定元素（#2）；
 * 5. 下拉全部改用宿主 UI 库的 Select（设计态与运行时同观感）并支持搜索（#3）。
 *
 * 配置写在页面级 page.externalSources，本元素通过 externalRef 引用它：
 * 触发元素固定为「打开弹窗时点击的那个元素」，弹窗不再提供触发元素选择。
 *
 * 选项类目标会在保存时把它的 options 绑到结果路径（取数与 label/value 映射都归本弹窗管）；
 * 输入框目标恒为「搜索候选」：只生成一条 select 映射写到 options.<节点ID>，不回填元素自身的值 ——
 * 数据由用户在下拉里自行选择，输入过程不会被第一条自动改写（单条响应也会成为一条候选）。
 */
import { computed, reactive, ref, watch } from "vue";
import type { DataShape, ExternalDataSource, ExternalResponseMap, ExternalSubMap } from "@x-ac/web-design-core";
import {
  canOwnExternalSource,
  collectBindableElements,
  bareKey,
  findLocation,
  responsesOf,
  type BindableElement,
  type Method,
} from "@x-ac/web-design-core";
import { useDesignerStore } from "../store";
import { useMaterialCatalog } from "../../materials/catalog";
import { useExternalSourceDialog, useHeadersDialog, useSubMapDialog } from "../dialogs";
import { useNotify } from "../ui/kit";
import ModalShell from "../ui/ModalShell.vue";
import HelpTip from "../ui/HelpTip.vue";
import UiControl from "../ui/UiControl.vue";

const store = useDesignerStore();
const catalog = useMaterialCatalog();
const dialog = useExternalSourceDialog();
const headersDialog = useHeadersDialog();
const subMapDialog = useSubMapDialog();
const notify = useNotify();

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const METHOD_OPTIONS = METHODS.map((m) => ({ label: m, value: m }));

/**
 * 「显示内容」输入框的占位文案。
 * 模板里直接写 {{}} 会被 Vue 当成插值解析，所以这类文案统一放脚本里。
 */
const DISPLAY_PLACEHOLDER = "如 {{data.name}}/{{data.code}}（留空 = 用名称字段）";

interface DraftParam {
  key: string;
  path: string;
  label?: string;
}
interface DraftResponse {
  /** 选中目标元素（可空 = 只填路径，不强绑定元素，#2） */
  targetNodeId: string;
  /** 写入 scope 的路径，可手改 */
  scopePath: string;
  labelField: string;
  valueField: string;
  /** 显示内容模板：用 {{}} 从响应数据取数并自由拼接（#3） */
  display: string;
  /** 父字段名（响应目标为子表单时）：明细数组所在的字段名 */
  parentField: string;
  /** 子映射（响应目标为子表单时）：响应行内各字段 → 子表单字段 */
  subMaps: ExternalSubMap[];
  /** 当前推断形态：选项类目标 → select，否则 form */
  shape: DataShape;
}

const draft = reactive({
  name: "",
  method: "GET" as Method,
  url: "",
  headers: {} as Record<string, string>,
  once: true,
  triggerLength: 0,
  // 列表字段：数据源级统一配置（一次响应只有一个数组，各映射都基于它逐项生成）
  listField: "",
  params: [] as DraftParam[],
  responses: [] as DraftResponse[],
});

/** 当前编辑的外部数据源 id（新建时生成，保存即作为 page.externalSources 的键） */
const currentSourceId = ref("");
function genSourceId(): string {
  return `ext_${Math.random().toString(36).slice(2, 10)}`;
}

/** 当前节点引用的页面级外部数据源（若有） */
function currentSource(): ExternalDataSource | undefined {
  const ref = node.value?.externalRef;
  return ref ? store.page.externalSources?.[ref] : undefined;
}

const node = computed(() => {
  const target = dialog.target.value;
  if (!target) return undefined;
  return findLocation(store.page.children, target.nodeId)?.node;
});

/** 全部元素（含非表单元素，#1）：用于参数 / 触发 / 响应目标的下拉 */
const elements = computed(() => collectBindableElements(store.page, { registry: catalog, includeAll: true }));

/** 按路径选择的元素下拉（参数 / 触发用） */
const elementOptions = computed(() =>
  elements.value.map((item) => ({
    label: `${item.label}${item.isGroup ? "（整组）" : ""} · ${item.path}`,
    value: item.path,
  })),
);

/** 按节点选择的元素下拉（响应目标用，便于自动判定「选项类」） */
const targetOptions = computed(() =>
  elements.value.map((item) => ({
    label: `${item.label}${item.isOption ? "（选项）" : ""}${item.isGroup ? "（整组）" : ""} · ${item.path}`,
    value: item.nodeId,
  })),
);

/** 本数据源绑定的元素：打开弹窗时点击的那个（触发值即取自它） */
const boundLabel = computed(() => {
  const target = dialog.target.value;
  if (!target) return "";
  return target.label || node.value?.component || target.nodeId;
});

/** 绑定元素实际的数据路径（仅用于展示） */
const boundPath = computed(() => {
  const target = dialog.target.value;
  if (!target) return "";
  return elements.value.find((el) => el.nodeId === target.nodeId)?.path ?? "";
});

function elementByNodeId(nodeId: string): BindableElement | undefined {
  return elements.value.find((item) => item.nodeId === nodeId);
}
function elementByPath(path: string): BindableElement | undefined {
  return elements.value.find((item) => item.path === path);
}
function isOptionTarget(resp: DraftResponse): boolean {
  return Boolean(elementByNodeId(resp.targetNodeId)?.isOption);
}

/** 目标是否为「可输入 / 下拉」类 —— 这类元素才需要「显示内容」模板（#3） */
function isValueTarget(resp: DraftResponse): boolean {
  const el = elementByNodeId(resp.targetNodeId);
  return Boolean(el && (el.isFormControl || el.isOption));
}

/** 目标是否为「输入框」：core 里只有 input 物料带 options 字段，能消费候选项 */
function isInputTarget(resp: DraftResponse): boolean {
  const el = elementByNodeId(resp.targetNodeId);
  return Boolean(el && !el.isOption && !el.isGroup && bareKey(el.component) === "input");
}

/** 目标是否为子表单（明细容器）—— 这类目标才需要「父字段名 + 子映射」（#4） */
function isGroupTarget(resp: DraftResponse): boolean {
  return Boolean(elementByNodeId(resp.targetNodeId)?.isGroup);
}

/** 父字段名默认值：明细数组所在字段（元素路径的最后一段） */
function defaultParentField(el: BindableElement): string {
  const segment = el.path.split(".").pop() ?? "";
  return segment.replace(/\[\d+\]$/, "");
}

/**
 * 响应映射的说明文案。
 * 收进标题栏的问号图标（HelpTip 组件）、鼠标指向时展示：
 * 说明正文铺在卡片里会把卡片撑得很高。
 */
function tipOf(resp: DraftResponse): string {
  const parts: string[] = [];
  if (isGroupTarget(resp)) {
    parts.push(
      `响应数组的每一行会填成子表单的一条明细。父字段名「${resp.parentField || "（未填）"}」是明细数组所在的字段，子映射只需填它的子字段。`,
    );
  }
  if (isValueTarget(resp)) {
    parts.push(
      "「显示内容」支持用 {{}} 从响应数据取数并自由拼接（如 {{data.a}}/{{data.b}}）；下拉逐项渲染，输入框把整段响应渲染成字符串。",
    );
  }
  if (isInputTarget(resp)) {
    parts.push(
      "输入框的外部数据源恒为「搜索候选」：响应写成 options.<节点ID> 的候选项，由用户自行点选一条；每条候选的展示文本由「显示内容」模板生成，单条响应也会作为一条候选。",
    );
  }
  if (!resp.targetNodeId) {
    parts.push(`未选目标元素：结果整体写入 ${resp.scopePath}，由你自行把某元素属性绑到该路径。`);
  } else if (!isOptionTarget(resp)) {
    parts.push(`目标不是选项类元素，响应将整体写入 ${resp.scopePath} 的值。`);
  }
  if (!parts.length) {
    parts.push("选项类目标：响应按名称 / 值字段映射成选项；列表字段留空表示响应本身就是数组。");
  }
  return parts.join("\n");
}

/** 页面里「可输入 / 下拉」类元素：外部数据源通常喂给这些元素 */
const valueElements = computed(() => elements.value.filter((el) => el.isFormControl || el.isOption));

const headerCount = computed(() => Object.keys(draft.headers).length);

/** 默认响应路径：external.<名称> */
function defaultScopePath(): string {
  const key = (draft.name.trim() || "data").replace(/[^\w$一-龥]/g, "") || "data";
  return `external.${key}`;
}

function reset(): void {
  const source = currentSource();
  const saved = responsesOf(source);
  // 输入框候选生成的 options.<id> 映射不单独占一张卡片，回落成输入框目标那一张。
  // 候选模式不生成 form.<id> 值映射，因此可能需据此重建整张卡片（见下方补建）。
  const candidateMaps = new Map<string, ExternalResponseMap>();
  for (const r of saved) {
    const match = /^options\.(.+)$/.exec(r.scopePath);
    if (r.shape === "select" && match) candidateMaps.set(match[1]!, r);
  }
  currentSourceId.value = source?.id ?? genSourceId();
  Object.assign(draft, {
    name: source?.name ?? "",
    method: (source?.method ?? "GET") as Method,
    url: source?.url ?? "",
    headers: { ...(source?.headers ?? {}) },
    once: source?.once !== false,
    triggerLength: Number(source?.triggerLength ?? 0),
    // 兼容旧数据：数据源级没写时，取第一条映射上的列表字段提升到顶层
    listField: source?.listField ?? saved.find((r) => r.listField)?.listField ?? "",
    params: (source?.params ?? []).map((item) => ({ ...item })),
    responses: saved
      .filter((r) => {
        const match = /^options\.(.+)$/.exec(r.scopePath);
        return !(r.shape === "select" && match && candidateMaps.has(match[1]!));
      })
      .map((r) => ({
        targetNodeId: "",
        scopePath: r.scopePath,
        labelField: r.labelField ?? "",
        valueField: r.valueField ?? "",
        display: r.display ?? "",
        parentField: r.parentField ?? "",
        subMaps: (r.subMaps ?? []).map((m) => ({ ...m })),
        shape: r.shape ?? "form",
      })),
  });
  // 反查每个响应命中的目标节点（scopePath === 某元素路径）
  for (const resp of draft.responses) {
    const el = elements.value.find((e) => e.path === resp.scopePath);
    if (el) {
      resp.targetNodeId = el.nodeId;
      resp.shape = el.isOption ? "select" : "form";
      if (el.isOption) {
        resp.labelField = resp.labelField || "label";
        resp.valueField = resp.valueField || "value";
      }
      if (el.isGroup && !resp.parentField) resp.parentField = defaultParentField(el);
    }
  }

  // 输入框的候选映射只写了 options.<id>、没有对应卡片时，按候选项重建一张，
  // 否则重新打开弹窗会丢掉该输入框的外部数据源配置。
  for (const [id, cand] of candidateMaps) {
    if (draft.responses.some((resp) => resp.targetNodeId === id)) continue;
    const el = elements.value.find((e) => e.nodeId === id);
    if (!el) continue;
    draft.responses.push({
      targetNodeId: id,
      scopePath: el.path,
      labelField: cand.labelField ?? "",
      valueField: cand.valueField ?? "",
      display: cand.display ?? "",
      parentField: "",
      subMaps: [],
      shape: "select",
    });
  }
}

watch(
  () => [dialog.visible.value, dialog.target.value?.nodeId] as const,
  ([visible]) => {
    if (!visible) return;
    const target = node.value;
    // 兜底：内容不可被用户改变的元素不允许拥有外部数据源
    if (target && !canOwnExternalSource(target.component, catalog)) {
      notify("该元素的内容不可被用户改变，不能添加外部数据源", "error");
      dialog.close();
      return;
    }
    reset();
  },
  { immediate: true },
);

/* ---------------- 参数映射 ---------------- */

function addParam(): void {
  draft.params.push({ key: "", path: "" });
}
function removeParam(index: number): void {
  draft.params.splice(index, 1);
}
function onParamElement(index: number, path: string): void {
  const item = draft.params[index];
  if (!item) return;
  item.path = path;
  item.label = elementByPath(path)?.label;
}

/* ---------------- 响应映射（多条，#4） ---------------- */

function addResponse(): void {
  const resp: DraftResponse = {
    targetNodeId: "",
    scopePath: defaultScopePath(),
    labelField: "",
    valueField: "",
    display: "",
    parentField: "",
    subMaps: [],
    shape: "form",
  };
  // 只有一个「可输入 / 下拉」元素时默认选中目标，省去一次手动选择（#3）
  if (valueElements.value.length === 1) {
    const el = valueElements.value[0]!;
    resp.targetNodeId = el.nodeId;
    resp.scopePath = el.path;
    resp.shape = el.isOption ? "select" : "form";
    if (el.isOption) {
      resp.labelField = "label";
      resp.valueField = "value";
    }
  }
  draft.responses.push(resp);
}
function removeResponse(index: number): void {
  draft.responses.splice(index, 1);
}
function onResponseTarget(index: number, nodeId: string): void {
  const resp = draft.responses[index];
  if (!resp) return;
  resp.targetNodeId = nodeId;
  const el = elementByNodeId(nodeId);
  if (el) {
    resp.scopePath = el.path;
    resp.shape = el.isOption ? "select" : "form";
    if (el.isOption) {
      resp.labelField = resp.labelField || "label";
      resp.valueField = resp.valueField || "value";
    }
    // 目标是子表单 → 给父字段名默认值；换成别的目标则清掉子映射
    resp.parentField = el.isGroup ? defaultParentField(el) : "";
    if (!el.isGroup) resp.subMaps = [];
  }
}

/**
 * 打开子映射弹窗（#4）。
 * 取消时保留原有配置（弹窗 resolve null 表示「没改」）。
 */
async function openSubMap(index: number): Promise<void> {
  const resp = draft.responses[index];
  if (!resp) return;
  const el = elementByNodeId(resp.targetNodeId);
  if (!el?.isGroup) return;
  const maps = await subMapDialog.open({
    responseIndex: index,
    parentField: resp.parentField,
    groupNodeId: resp.targetNodeId,
    label: el.label,
    maps: resp.subMaps,
  });
  if (maps) resp.subMaps = maps;
}

/* ---------------- 请求头 ---------------- */

async function openHeaders(): Promise<void> {
  const rows = await headersDialog.open(draft.headers);
  // null = 取消，保留原值；确认则整体覆盖（把请求头全删掉也必须生效）
  if (!rows) return;
  const cleaned: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) cleaned[key] = row.value;
  }
  draft.headers = cleaned;
}

/* ---------------- 保存 / 移除 ---------------- */

/**
 * 自动绑定到节点 options 的映射，返回「节点ID → 绑定表达式」：
 * - 选项类目标：结果直接写在该元素的绑定路径上；
 * - 候选下拉：结果额外写在 options.<节点ID>，由输入框消费成可点选的下拉。
 * 保存时据此整体覆盖，移除 / 关闭时据此清理，避免留下悬空引用。
 */
function autoOptionBindings(source: ExternalDataSource | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of responsesOf(source)) {
    const el = elements.value.find((e) => e.path === r.scopePath && e.isOption);
    if (el) out.set(el.nodeId, `{{${r.scopePath}}}`);
    const match = /^options\.(.+)$/.exec(r.scopePath);
    if (r.shape === "select" && match) {
      const id = match[1]!;
      if (elements.value.some((e) => e.nodeId === id && !e.isOption)) {
        out.set(id, `{{${r.scopePath}}}`);
      }
    }
  }
  return out;
}

function buildSource(): ExternalDataSource {
  const source: ExternalDataSource = {
    id: currentSourceId.value || genSourceId(),
    method: draft.method,
    url: draft.url.trim(),
  };
  if (draft.name.trim()) source.name = draft.name.trim();
  if (Object.keys(draft.headers).length) source.headers = { ...draft.headers };

  const params = draft.params.filter((item) => item.key.trim() && item.path);
  if (params.length) {
    source.params = params.map((item) => ({ key: item.key.trim(), path: item.path, label: item.label }));
  }

  // 列表字段：数据源级统一配置，各映射只描述「数组里的一项怎么映射」
  const listField = draft.listField.trim();
  if (listField) source.listField = listField;

  const responses: ExternalResponseMap[] = [];
  // 只有「数据源拥有者」这个输入框才是候选源；其余映射是选中后回填的目标。
  // 这样「员工搜索选一条 → 回填个人档案」这类联动才成立。
  const ownerId = dialog.target.value?.nodeId ?? "";
  for (const r of draft.responses.filter((item) => item.scopePath.trim())) {
    if (isInputTarget(r) && r.targetNodeId && r.targetNodeId === ownerId) {
      const candidate: ExternalResponseMap = {
        scopePath: `options.${ownerId}`,
        shape: "select",
        labelField: r.labelField.trim() || "label",
        valueField: r.valueField.trim() || "value",
      };
      if (r.display.trim()) candidate.display = r.display.trim();
      responses.push(candidate);
      continue;
    }

    const out: ExternalResponseMap = { scopePath: r.scopePath.trim() };
    const el = elementByNodeId(r.targetNodeId);
    if (el?.isOption) {
      // 选项类：恒为选项形态；value 不配则运行时回退到 label（#5）
      out.shape = "select";
      out.labelField = r.labelField.trim() || "label";
      out.valueField = r.valueField.trim();
    }
    if (r.display.trim()) out.display = r.display.trim();
    // 父字段名 + 子映射：只对子表单目标有意义（#4）
    if (r.parentField.trim()) out.parentField = r.parentField.trim();
    if (r.subMaps.length) {
      out.subMaps = r.subMaps.map((m) => ({ field: m.field, from: m.from }));
    }
    responses.push(out);
  }
  if (responses.length) source.responses = responses;

  source.once = draft.once;
  if (draft.triggerLength > 0) {
    source.triggerLength = draft.triggerLength;
  }
  return source;
}

function save(): void {
  const target = dialog.target.value;
  if (!target) return;
  if (!draft.url.trim()) {
    notify("请填写请求地址", "error");
    return;
  }
  // 输入框候选靠「显示内容」模板逐项生成展示文本，没模板就没有可点的文字
  if (draft.responses.some((r) => isInputTarget(r) && !r.display.trim())) {
    notify("输入框的外部数据源需要填写「显示内容」，候选项靠它生成展示文本", "error");
    return;
  }

  const prev = autoOptionBindings(currentSource());
  const source = buildSource();
  store.upsertExternalSource(source);
  store.setNodeExternalRef(target.nodeId, source.id);

  // 选项类 / 候选下拉的 options 自动绑定到结果路径；不再绑定的要清掉，避免悬空引用
  const next = autoOptionBindings(source);
  for (const id of prev.keys()) {
    if (!next.has(id)) store.updateNodeProp(id, "options", "");
  }
  for (const [id, expr] of next) store.updateNodeProp(id, "options", expr);

  dialog.close();
  notify("外部数据源已保存", "success");
}

function remove(): void {
  const target = dialog.target.value;
  if (!target) return;
  const prev = autoOptionBindings(currentSource());
  store.removeExternalSource(currentSourceId.value);
  store.setNodeExternalRef(target.nodeId, undefined);
  for (const id of prev.keys()) store.updateNodeProp(id, "options", "");
  dialog.close();
  notify("已移除外部数据源", "success");
}
</script>

<template>
  <ModalShell
    v-if="dialog.visible.value && dialog.target.value"
    :title="`外部数据源 · ${dialog.target.value.label}`"
    width="620px"
    @close="dialog.close()"
  >
    <div class="ext">
      <!-- 基本信息 -->
      <div class="ext__row">
        <label class="ext__label">名称</label>
        <input v-model="draft.name" class="ext__input" placeholder="如 部门列表" spellcheck="false" />
      </div>

      <div class="ext__row ext__row--split">
        <div class="ext__cell">
          <label class="ext__label">请求方法</label>
          <UiControl as="Select" v-model="draft.method" :options="METHOD_OPTIONS" size="small" />
        </div>
        <div class="ext__cell ext__cell--grow">
          <label class="ext__label">请求地址 URL</label>
          <input v-model="draft.url" class="ext__input wb-mono" placeholder="/api/dept/list" spellcheck="false" />
        </div>
      </div>

      <div class="ext__row">
        <label class="ext__label">请求头</label>
        <button type="button" class="ext__ghost" @click="openHeaders">
          {{ headerCount ? `已设置 ${headerCount} 个请求头` : "设置请求头…" }}
        </button>
      </div>

      <!-- 触发：本数据源绑定在点击的元素上，触发值即取自该元素 -->
      <div class="ext__row ext__row--split">
        <div class="ext__cell">
          <label class="ext__label">触发长度</label>
          <input
            v-model.number="draft.triggerLength"
            class="ext__input"
            type="number"
            min="0"
            placeholder="0 = 加载即取"
          />
        </div>
        <div class="ext__cell ext__cell--grow">
          <label class="ext__label">触发元素</label>
          <div class="ext__static" :title="boundPath">{{ boundLabel }}</div>
        </div>
      </div>
      <div class="ext__note">
        本数据源绑定在「<b>{{ boundLabel }}</b>」<span v-if="boundPath">（{{ boundPath }}）</span>
        上，触发值取自该元素自身的值，无需另选触发元素。
      </div>

      <label class="ext__switch">
        <input v-model="draft.once" type="checkbox" />
        <span>只请求一次（当前页面仅请求一次）</span>
      </label>

      <!-- 请求参数映射 -->
      <div class="ext__section">
        请求参数映射
        <span class="ext__section-hint">只能选当前页面的元素；整组子表单可作为单个参数值</span>
      </div>
      <div class="ext__params">
        <div v-for="(item, index) in draft.params" :key="index" class="ext__param">
          <input v-model="item.key" class="ext__input" placeholder="参数名" spellcheck="false" />
          <UiControl
            as="Select"
            :model-value="item.path"
            :options="elementOptions"
            filterable
            clearable
            size="small"
            placeholder="选择元素…"
            @update:model-value="(v: string) => onParamElement(index, v)"
          />
          <button type="button" class="ext__del" title="删除" @click="removeParam(index)">×</button>
        </div>
        <button type="button" class="ext__ghost ext__ghost--block" @click="addParam">+ 添加参数</button>
      </div>

      <!-- 响应数据映射（多条，#4） -->
      <div class="ext__section">
        响应数据映射
        <span class="ext__section-hint">可设多条，各自写不同路径；留空则不写数据（仅触发请求）</span>
      </div>
      <!-- 列表字段：数据源级统一配置。选项与各条映射都基于这个数组逐项生成，
           所以放在顶层，而不是每条映射里各填一遍。 -->
      <div class="ext__row">
        <label class="ext__label">列表字段</label>
        <input
          v-model="draft.listField"
          class="ext__input wb-mono"
          placeholder="响应里数组所在的字段，如 data.list；留空 = 响应本身是数组"
          spellcheck="false"
        />
      </div>
      <div class="ext__params">
        <div v-for="(resp, index) in draft.responses" :key="index" class="ext__resp">
          <div class="ext__resp-head">
            <span class="ext__resp-no">映射 {{ index + 1 }}</span>
            <HelpTip :text="tipOf(resp)" />
            <button type="button" class="ext__del" title="删除映射" @click="removeResponse(index)">×</button>
          </div>
          <!-- 目标元素：候选项基于上面的「列表字段」逐项生成，这里只选写给谁 -->
          <div class="ext__row">
            <UiControl
              as="Select"
              :model-value="resp.targetNodeId"
              :options="targetOptions"
              filterable
              clearable
              size="small"
              placeholder="选择目标元素（可空）"
              @update:model-value="(v: string) => onResponseTarget(index, v)"
            />
          </div>
          <div class="ext__row">
            <label class="ext__label">写入路径</label>
            <input v-model="resp.scopePath" class="ext__input wb-mono" placeholder="如 external.deptList" spellcheck="false" />
          </div>
          <div v-if="isGroupTarget(resp)" class="ext__row ext__row--split">
            <div class="ext__cell">
              <label class="ext__label">父字段名</label>
              <input v-model="resp.parentField" class="ext__input wb-mono" placeholder="如 items" spellcheck="false" />
            </div>
            <div class="ext__cell ext__cell--grow">
              <label class="ext__label">子映射</label>
              <button type="button" class="ext__ghost" @click="openSubMap(index)">
                {{ resp.subMaps.length ? `已配置 ${resp.subMaps.length} 项` : "设置子映射…" }}
              </button>
            </div>
          </div>
          <div v-if="isOptionTarget(resp)" class="ext__row ext__row--split">
            <div class="ext__cell">
              <label class="ext__label">值字段</label>
              <input v-model="resp.valueField" class="ext__input wb-mono" placeholder="留空 = 用名称" spellcheck="false" />
            </div>
            <div class="ext__cell">
              <label class="ext__label">名称字段</label>
              <input v-model="resp.labelField" class="ext__input wb-mono" placeholder="label" spellcheck="false" />
            </div>
          </div>
          <div v-if="isValueTarget(resp)" class="ext__row">
            <label class="ext__label">显示内容</label>
            <input
              v-model="resp.display"
              class="ext__input wb-mono"
              :placeholder="DISPLAY_PLACEHOLDER"
              spellcheck="false"
            />
          </div>
        </div>
        <button type="button" class="ext__ghost ext__ghost--block" @click="addResponse">+ 添加响应映射</button>
      </div>
    </div>

    <template #footer>
      <button type="button" class="ext__remove" @click="remove">移除数据源</button>
      <span class="ext__spacer" />
      <button type="button" class="ext__cancel" @click="dialog.close()">取消</button>
      <button type="button" class="ext__ok" @click="save">保存</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.ext {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ext__row {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 10px;
}
.ext__row--split {
  grid-template-columns: 1fr 1fr;
}
.ext__cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ext__cell--grow {
  flex: 1;
}
.ext__label {
  font-size: 11.5px;
  color: var(--wb-ink3);
}
.ext__input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  font-size: 12.5px;
  font-family: inherit;
  color: var(--wb-ink);
  background: #fff;
}
.ext__input:focus {
  outline: none;
  border-color: var(--wb-primary);
  box-shadow: 0 0 0 3px rgba(47, 75, 255, 0.1);
}
/* 触发元素：只读展示（触发元素固定为打开弹窗时点击的那个元素） */
.ext__static {
  padding: 6px 8px;
  border: 1px dashed var(--wb-line);
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--wb-ink2);
  background: #fbfcfe;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ext__ghost {
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink2);
  cursor: pointer;
  text-align: left;
}
.ext__ghost:hover {
  border-color: var(--wb-primary);
  color: var(--wb-primary);
}
.ext__ghost--block {
  width: 100%;
  text-align: center;
  border-style: dashed;
}
.ext__switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--wb-ink2);
  cursor: pointer;
}
.ext__section {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--wb-line-soft);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--wb-ink3);
}
.ext__section-hint {
  margin-left: 8px;
  font-weight: 400;
  letter-spacing: 0;
  color: #b6bdcb;
}
.ext__params {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ext__param {
  display: grid;
  grid-template-columns: 140px 1fr 24px;
  gap: 6px;
  align-items: center;
}
.ext__del {
  border: none;
  background: transparent;
  color: var(--wb-ink3);
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
}
.ext__del:hover {
  color: var(--wb-danger);
}
.ext__resp {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--wb-line-soft);
  border-radius: 7px;
  background: #fbfcfe;
}
.ext__resp-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ext__resp-head .ext__del {
  margin-left: auto;
}
/* 目标元素 + 列表字段：两项各占一半宽度 */
.ext__resp-target {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  align-items: center;
}
.ext__resp-no {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--wb-ink3);
}
.ext__note {
  font-size: 11.5px;
  color: var(--wb-ink3);
  line-height: 1.7;
}
.ext__note code {
  font-family: var(--wb-mono);
  background: #fafbfd;
  border: 1px solid var(--wb-line-soft);
  border-radius: 3px;
  padding: 0 4px;
}
.ext__remove {
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink2);
  cursor: pointer;
}
.ext__remove:hover {
  border-color: var(--wb-danger);
  color: var(--wb-danger);
}
.ext__spacer {
  flex: 1;
}
.ext__cancel,
.ext__ok {
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.ext__cancel {
  border: 1px solid var(--wb-line);
  background: #fff;
  color: var(--wb-ink2);
}
.ext__ok {
  border: 1px solid var(--wb-primary);
  background: var(--wb-primary);
  color: #fff;
}
</style>
