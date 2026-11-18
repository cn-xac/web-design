<script setup lang="ts">
/**
 * 高级函数「完整使用说明」弹窗（由计算弹窗的问号按钮打开）。
 *
 * 说明内容较长，所以不塞进计算弹窗正文，也不放在会被裁剪的绝对定位浮层里：
 * 独立一层弹窗 + Teleport 到 body，避开 ModalShell 的 overflow: hidden。
 * 全部文本来自 core（`CALCULATION_FUNCTIONS` + calculation/usage.ts），
 * 与 docs/CALCULATION_FUNCTIONS.md 同源，避免文档与 UI 分叉。
 */
import {
  CALCULATION_RECIPES,
  CALCULATION_TROUBLESHOOTING,
  CALCULATION_USAGE_NOTES,
  calculationFunctionGroups,
} from "@x-ac/web-design-core";
import ModalShell from "../ui/ModalShell.vue";
import UiControl from "../ui/UiControl.vue";

const emit = defineEmits<{ close: [] }>();
const groups = calculationFunctionGroups();
</script>

<template>
  <Teleport to="body">
    <ModalShell title="高级函数使用说明" width="860px" @close="emit('close')">
      <div class="calc__help">
        <p class="calc__help-intro">
          高级函数只在数据计算算式里可用；函数名必须命中下方 30 个白名单，
          通用绑定表达式仍禁止函数调用。点击函数名可把签名插入算式，悬停可看单函数说明。
        </p>

        <section class="calc__help-block">
          <h4>一、通用规则</h4>
          <ol class="calc__help-list">
            <li v-for="(note, index) in CALCULATION_USAGE_NOTES" :key="index">{{ note }}</li>
          </ol>
        </section>

        <section class="calc__help-block">
          <h4>二、函数参考（30 个）</h4>
          <div v-for="group in groups" :key="group.group" class="calc__help-group">
            <h5>{{ group.group }}（{{ group.items.length }}）</h5>
            <div class="calc__help-grid">
              <div v-for="fn in group.items" :key="fn.name" class="calc__help-fn">
                <div class="calc__help-fn-head">
                  <code>{{ fn.signature }}</code>
                  <span>{{ fn.label }}</span>
                </div>
                <div><b>参数</b>{{ fn.params }}</div>
                <div><b>返回</b>{{ fn.returns }}</div>
                <div><b>示例</b><code>{{ fn.example }}</code></div>
                <div class="calc__help-fn-desc">{{ fn.description }}</div>
              </div>
            </div>
          </div>
        </section>

        <section class="calc__help-block">
          <h4>三、常见业务配方</h4>
          <table class="calc__help-table">
            <thead>
              <tr><th>场景</th><th>参与元素</th><th>算式 / 配置</th></tr>
            </thead>
            <tbody>
              <tr v-for="(recipe, index) in CALCULATION_RECIPES" :key="index">
                <td>{{ recipe.scene }}</td>
                <td>{{ recipe.operands }}</td>
                <td><code>{{ recipe.formula }}</code></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="calc__help-block">
          <h4>四、限制与排错</h4>
          <table class="calc__help-table">
            <thead>
              <tr><th>现象</th><th>原因</th><th>处理</th></tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in CALCULATION_TROUBLESHOOTING" :key="index">
                <td>{{ item.symptom }}</td>
                <td>{{ item.cause }}</td>
                <td>{{ item.fix }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <p class="calc__help-foot">
          完整手册：<code>docs/CALCULATION_FUNCTIONS.md</code>。本页内容由 core 常量生成，新增函数只需改内核函数表。
        </p>
      </div>

      <template #footer>
        <UiControl as="Button" class="calc__help-close" @click="emit('close')">关闭</UiControl>
      </template>
    </ModalShell>
  </Teleport>
</template>

<style scoped>
.calc__help {
  font-size: 12px;
  line-height: 1.8;
  color: var(--wb-ink2);
}
.calc__help-intro {
  margin: 0 0 14px;
  padding: 9px 11px;
  border: 1px solid #dbe4ff;
  border-radius: 7px;
  background: #f5f8ff;
}
.calc__help-block {
  margin-top: 18px;
}
.calc__help-block h4 {
  margin: 0 0 8px;
  font-size: 12.5px;
  color: var(--wb-ink);
}
.calc__help-group h5 {
  margin: 12px 0 6px;
  font-size: 11.5px;
  color: var(--wb-ink3);
}
.calc__help-list {
  margin: 0;
  padding-left: 20px;
}
.calc__help-list li {
  margin-bottom: 4px;
}
.calc__help-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.calc__help-fn {
  padding: 8px 10px;
  border: 1px solid var(--wb-line-soft);
  border-radius: 7px;
  background: #fbfcfe;
  font-size: 11.5px;
  line-height: 1.7;
}
.calc__help-fn-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 3px;
}
.calc__help-fn-head code {
  color: var(--wb-primary);
  font-size: 12px;
}
.calc__help-fn-head span {
  color: var(--wb-ink3);
}
.calc__help-fn b {
  display: inline-block;
  width: 32px;
  color: var(--wb-ink3);
  font-weight: 600;
}
.calc__help-fn code,
.calc__help-table code,
.calc__help-foot code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.calc__help-fn-desc {
  margin-top: 2px;
  color: var(--wb-ink3);
}
.calc__help-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
.calc__help-table th,
.calc__help-table td {
  padding: 6px 8px;
  border: 1px solid var(--wb-line-soft);
  text-align: left;
  vertical-align: top;
}
.calc__help-table th {
  background: #f5f7fb;
  color: var(--wb-ink3);
  font-weight: 600;
}
.calc__help-foot {
  margin: 18px 0 2px;
  font-size: 11.5px;
  color: var(--wb-ink3);
}
.calc__help-close {
  border: 1px solid var(--wb-line);
  border-radius: 5px;
  background: #fff;
  padding: 5px 14px;
  font-size: 12px;
  font-family: inherit;
  color: var(--wb-ink2);
  cursor: pointer;
}
.calc__help-close:hover {
  border-color: var(--wb-primary);
  color: var(--wb-primary);
}
</style>
