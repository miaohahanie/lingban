<script setup lang="ts">
import { ref } from 'vue'
import { useLingbanStore } from '../store'
import type { Quote } from '../../../shared/types'

const store = useLingbanStore()

const autostart = ref(Boolean(store.settings.autostart ?? true))
const autoPlan = ref(Boolean(store.settings.auto_plan ?? true))
const animEnabled = ref(Boolean(store.settings.pet_animation_enabled ?? true))
const playfulEnabled = ref(Boolean(store.settings.pet_playful_enabled ?? true))
const lowPower = ref(Boolean(store.settings.pet_low_power_mode ?? false))
const birthday = ref(String(store.settings.birthday || ''))
const apiKey = ref('')
const keyMsg = ref('')
const focusTarget = ref(Number(store.settings.daily_focus_target_sec || 4 * 3600) / 3600)
const quotes = ref<Quote[]>([])
const quotesLoaded = ref(false)
const newQuote = ref('')

async function init(): Promise<void> {
  if (!quotesLoaded.value) {
    quotes.value = await window.lingban.quotes.list()
    quotesLoaded.value = true
  }
}
void init()

async function saveGeneral(): Promise<void> {
  await window.lingban.app.setAutoStart(autostart.value)
  await window.lingban.settings.set('auto_plan', autoPlan.value)
  await window.lingban.animation.setEnabled(animEnabled.value)
  await window.lingban.settings.set('pet_playful_enabled', playfulEnabled.value)
  await window.lingban.settings.set('pet_low_power_mode', lowPower.value)
  await window.lingban.settings.set('birthday', birthday.value || null)
  await window.lingban.settings.set('daily_focus_target_sec', Math.round(Number(focusTarget.value) * 3600))
  store.toast = { title: '设置', body: '已保存 ✓' }
  setTimeout(() => { store.toast = null }, 2000)
}

async function testAndSaveKey(): Promise<void> {
  if (!apiKey.value) { keyMsg.value = '请输入 Key'; return }
  const ok = await window.lingban.ai.testKey(apiKey.value)
  keyMsg.value = ok ? '✓ 连接成功' : '✗ 连接失败（仍会保存，AI 不可用时将降级）'
  if (ok || true) await window.lingban.ai.setKey(apiKey.value)
}

async function clearKey(): Promise<void> {
  await window.lingban.ai.clearKey()
  apiKey.value = ''
  keyMsg.value = '已清除'
}

async function addQuote(): Promise<void> {
  if (!newQuote.value.trim()) return
  const q = await window.lingban.quotes.add({ text: newQuote.value.trim(), category: 'random' })
  quotes.value.unshift(q)
  newQuote.value = ''
}

async function toggleQuote(q: Quote): Promise<void> {
  await window.lingban.quotes.toggle(q.id)
  quotes.value = await window.lingban.quotes.list()
}

async function removeQuote(id: string): Promise<void> {
  await window.lingban.quotes.remove(id)
  quotes.value = quotes.value.filter(x => x.id !== id)
}

async function resetSoftware(): Promise<void> {
  await window.lingban.app.reset()
  window.location.reload()
}

async function close(): Promise<void> { await store.closePanel() }

let settingsDrag = false
let settingsLastX = 0
let settingsLastY = 0
let settingsRaf = 0
let settingsPendingDx = 0
let settingsPendingDy = 0
function dragStart(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (el.closest('button, input, select, textarea')) return
  settingsDrag = true
  settingsLastX = e.screenX
  settingsLastY = e.screenY
}
function dragMove(e: MouseEvent): void {
  if (!settingsDrag || (e.buttons & 1) === 0) { if (!(e.buttons & 1)) settingsDrag = false; return }
  const dx = e.screenX - settingsLastX
  const dy = e.screenY - settingsLastY
  settingsLastX = e.screenX
  settingsLastY = e.screenY
  settingsPendingDx += dx
  settingsPendingDy += dy
  if (!settingsRaf) {
    settingsRaf = requestAnimationFrame(() => {
      settingsRaf = 0
      const fx = settingsPendingDx
      const fy = settingsPendingDy
      settingsPendingDx = 0
      settingsPendingDy = 0
      if (fx || fy) void window.lingban.window.moveBy(fx, fy)
    })
  }
}
function dragEnd(): void { settingsDrag = false; if (settingsRaf) { cancelAnimationFrame(settingsRaf); settingsRaf = 0 }; settingsPendingDx = 0; settingsPendingDy = 0 }
window.addEventListener('mouseup', dragEnd)
</script>

<template>
  <div class="modal-overlay interactive">
    <div class="modal-card" @mousedown="dragStart" @mousemove="dragMove" @mouseup="dragEnd">
      <div class="modal-head">
        <div class="modal-title" style="cursor:grab">灵伴 · 设置 <span style="font-size:12px;color:#8a97b5">（按住顶部拖动）</span></div>
        <button class="close-btn" @click="close">✕</button>
      </div>

      <div class="stat-line">版本 v{{ store.version }}</div>

      <div class="form-row"><input class="checkbox" type="checkbox" v-model="autostart" /><label>开机自启动</label></div>
      <div class="form-row"><input class="checkbox" type="checkbox" v-model="autoPlan" /><label>启动时自动生成今日计划</label></div>
      <div class="form-row"><input class="checkbox" type="checkbox" v-model="animEnabled" /><label>桌宠动画（GIF 素材）</label></div>
      <div class="form-row"><input class="checkbox" type="checkbox" v-model="playfulEnabled" /><label>整活/摸鱼互动（小手机真好玩等）</label></div>
      <div class="form-row"><input class="checkbox" type="checkbox" v-model="lowPower" /><label>低功耗模式（仅静态帧）</label></div>
      <div class="form-row"><input class="field" type="date" v-model="birthday" /><label>生日（可选）</label></div>
      <div class="form-row"><input class="field" style="width:90px" type="number" step="0.5" v-model.number="focusTarget" /><label>每日专注目标（小时）</label></div>

      <button class="primary-btn" @click="saveGeneral">保存设置</button>

      <hr style="border:none;border-top:1px solid #e3e7f0;margin:16px 0" />

      <div class="modal-title" style="font-size:15px">DeepSeek API Key</div>
      <div class="form-row">
        <input class="field" style="flex:1" type="password" v-model="apiKey" placeholder="sk-..." />
        <button class="primary-btn" @click="testAndSaveKey">测试并保存</button>
        <button class="primary-btn" @click="clearKey">清除</button>
      </div>
      <div v-if="keyMsg" class="stat-line">{{ keyMsg }}</div>

      <hr style="border:none;border-top:1px solid #e3e7f0;margin:16px 0" />

      <div class="modal-title" style="font-size:15px">言语库</div>
      <div class="form-row">
        <input class="field" style="flex:1" v-model="newQuote" placeholder="新增一句语料" />
        <button class="primary-btn" @click="addQuote">添加</button>
      </div>
      <div v-for="q in quotes" :key="q.id" class="form-row">
        <input class="checkbox" type="checkbox" :checked="q.enabled === 1" @change="toggleQuote(q)" />
        <span class="task-title" :class="{ 'task-done': q.enabled !== 1 }">{{ q.text }}</span>
        <button class="icon-btn" @click="removeQuote(q.id)">🗑</button>
      </div>

      <hr style="border:none;border-top:1px solid #e3e7f0;margin:16px 0" />

      <div class="timer-control">
        <button class="primary-btn" style="background:#f3dada;color:#a05555" @click="resetSoftware">重置软件（保留任务/日记等数据）</button>
        <button class="primary-btn" @click="close">关闭</button>
      </div>
    </div>
  </div>
</template>