<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLingbanStore } from '../store'
import type { TaskTag } from '../../../shared/types'

const store = useLingbanStore()
const step = ref(0)
const autostart = ref(true)
const autoPlan = ref(true)
const workDays = ref<number[]>([1, 2, 3, 4, 5])
const hours = ref<boolean[]>(Array.from({ length: 24 }, (_, i) => (i >= 9 && i < 12) || (i >= 14 && i < 18)))
const submitting = ref(false)
const apiKey = ref('')
const keyTest = ref('')
const birthday = ref('')
const tasks = ref<{ title: string; tag: TaskTag; estimateMinutes: number; estimateDays: number }[]>([
  { title: '', tag: 'daily', estimateMinutes: 25, estimateDays: 3 }
])

const dayNames = ['日', '一', '二', '三', '四', '五', '六']

function toggleDay(d: number): void {
  if (workDays.value.includes(d)) workDays.value = workDays.value.filter(x => x !== d)
  else workDays.value = [...workDays.value, d].sort()
}

function toggleHour(h: number): void {
  hours.value[h] = !hours.value[h]
}

function toSegments(list: boolean[]): { dayOfWeek: number; startHour: number; endHour: number }[] {
  const segs: { startHour: number; endHour: number }[] = []
  let start = -1
  for (let h = 0; h <= 24; h++) {
    const on = h < 24 && list[h]
    if (on && start === -1) start = h
    if (!on && start !== -1) {
      segs.push({ startHour: start, endHour: h })
      start = -1
    }
  }
  if (!segs.length) segs.push({ startHour: 9, endHour: 18 })
  return segs.map(s => ({ ...s, dayOfWeek: -1 }))
}

const selectedHoursText = computed(() => {
  const segs = toSegments(hours.value)
  return '已选：' + segs.map(s => String(s.startHour).padStart(2, '0') + ':00–' + String(s.endHour).padStart(2, '0') + ':00').join('、')
})

async function testKey(): Promise<void> {
  if (!apiKey.value) { keyTest.value = '请输入 Key'; return }
  const ok = await window.lingban.ai.testKey(apiKey.value)
  keyTest.value = ok ? '✓ 连接成功' : '✗ 连接失败'
}

function addTask(): void {
  tasks.value.push({ title: '', tag: 'daily', estimateMinutes: 25, estimateDays: 3 })
}
function removeTask(i: number): void { tasks.value.splice(i, 1) }

function setInteractive(v: boolean): void { void window.lingban.window.setInteractive(v) }

async function finish(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    await window.lingban.onboarding.complete({
      autostart: autostart.value,
      autoPlan: autoPlan.value,
      workDays: workDays.value.length ? [...workDays.value] : [1, 2, 3, 4, 5],
      workHours: toSegments(hours.value),
      apiKey: apiKey.value || undefined,
      tasks: tasks.value.filter(t => t.title.trim()).map(t => ({
        title: t.title.trim(),
        tag: t.tag,
        estimateMinutes: Number(t.estimateMinutes) || 25,
        estimateDays: t.tag === 'once' ? Number(t.estimateDays) || 3 : undefined
      })),
      birthday: birthday.value || undefined
    })
    store.onboardingDone = true
    await store.loadAll()
  } catch (e) {
    console.error('onboarding finish failed', e)
    store.toast = { title: '配置出错了', body: String(e) }
  } finally {
    submitting.value = false
  }
}

function next(): void { step.value++ }
function prev(): void { if (step.value > 0) step.value-- }
</script>

<template>
  <div class="modal-overlay" @mousemove="setInteractive(true)" @mouseleave="setInteractive(false)">
    <div class="modal-card">
      <div class="step-dots">
        <span v-for="i in 5" :key="i" class="dot" :class="{ active: i - 1 === step }"></span>
      </div>

      <template v-if="step === 0">
        <div class="modal-title">欢迎来到灵伴 👋</div>
        <p style="font-size:14px;color:#5b6a8c">我是你的桌面女仆 AI 室友，会规划日程、陪伴专注、温暖复盘。接下来简单配置一下，马上就能见面~</p>
        <div class="form-row" style="margin-top:16px">
          <input class="checkbox" type="checkbox" v-model="autostart" />
          <label>随系统开机自启动（推荐）</label>
        </div>
        <div class="form-row">
          <input class="checkbox" type="checkbox" v-model="autoPlan" />
          <label>启动后自动生成今日计划（推荐）</label>
        </div>
        <div class="timer-control">
          <button class="primary-btn" @click="next">下一步</button>
        </div>
      </template>

      <template v-if="step === 1">
        <div class="modal-title">工作节奏 🗓️</div>
        <p style="font-size:13px;color:#5b6a8c">点亮你的工作日</p>
        <div class="day-picker">
          <button v-for="(n, i) in dayNames" :key="i" class="hour-box" :class="{ on: workDays.includes(i) }" @click="toggleDay(i)">{{ n }}</button>
        </div>
        <p style="font-size:13px;color:#5b6a8c;margin-top:14px">点亮每日工作时段（可点亮多段，如 9–12 / 14–18）</p>
        <div class="hour-picker">
          <button
            v-for="h in 24"
            :key="h"
            class="hour-box"
            :class="{ on: hours[h - 1] }"
            :title="String(h - 1).padStart(2, '0') + ':00'"
            @click="toggleHour(h - 1)"
          >{{ String(h - 1).padStart(2, '0') }}</button>
        </div>
        <div class="stat-line" style="margin-top:8px">{{ selectedHoursText }}</div>
        <div class="timer-control">
          <button class="primary-btn" @click="prev">上一步</button>
          <button class="primary-btn" @click="next">下一步</button>
        </div>
      </template>

      <template v-if="step === 2">
        <div class="modal-title">AI 大脑 🤖（可选）</div>
        <p style="font-size:13px;color:#5b6a8c">填写 DeepSeek API Key 后，灵伴可以智能排期、写复盘和聊天；不上传任何本地路径。</p>
        <div class="form-row">
          <input class="field" style="flex:1" type="password" v-model="apiKey" placeholder="sk-..." />
          <button class="primary-btn" @click="testKey">测试连接</button>
        </div>
        <div v-if="keyTest" class="stat-line">{{ keyTest }}</div>
        <div class="timer-control">
          <button class="primary-btn" @click="prev">上一步</button>
          <button class="primary-btn" @click="next">下一步</button>
        </div>
      </template>

      <template v-if="step === 3">
        <div class="modal-title">初始任务 📝</div>
        <div v-for="(t, i) in tasks" :key="i" class="form-row">
          <input class="field" style="flex:1" v-model="t.title" :placeholder="'任务 ' + (i + 1)" />
          <select class="field" v-model="t.tag">
            <option value="daily">每日</option>
            <option value="weekly">每周</option>
            <option value="once">一次性</option>
          </select>
          <input class="field" style="width:70px" type="number" v-model.number="t.estimateMinutes" title="分钟" />
          <input v-if="t.tag === 'once'" class="field" style="width:70px" type="number" v-model.number="t.estimateDays" title="天数" />
          <button class="icon-btn" @click="removeTask(i)">🗑</button>
        </div>
        <button class="primary-btn" @click="addTask">+ 添加任务</button>
        <div class="timer-control">
          <button class="primary-btn" @click="prev">上一步</button>
          <button class="primary-btn" @click="next">下一步</button>
        </div>
      </template>

      <template v-if="step === 4">
        <div class="modal-title">最后一步 🎂</div>
        <p style="font-size:13px;color:#5b6a8c">填写生日（可选），生日当天灵伴会为你播放「生日快乐」专属动画。</p>
        <div class="form-row">
          <input class="field" type="date" v-model="birthday" />
        </div>
        <div class="timer-control">
          <button class="primary-btn" @click="prev">上一步</button>
          <button class="primary-btn" :disabled="submitting" @click="finish">{{ submitting ? '配置中…' : '开始使用 ✨' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>