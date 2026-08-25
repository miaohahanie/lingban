<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLingbanStore } from '../store'
import type { Task, ScheduleItem, FocusType, PanelName } from '../../../shared/types'

const store = useLingbanStore()
const tab = ref<'tasks' | 'diary' | 'timer' | 'calendar'>(
    store.panel === 'tasks' || store.panel === 'diary' || store.panel === 'timer' || store.panel === 'calendar' ? store.panel : 'tasks'
  )

watch(() => store.panel, (p: PanelName | null) => {
  if (p === 'tasks' || p === 'diary' || p === 'timer' || p === 'calendar') tab.value = p
})

watch(tab, async (t) => {
  if (t === 'diary') await store.refreshDiary()
  if (t === 'calendar') await store.refreshSchedules()
})

async function close(): Promise<void> { await store.closePanel() }

// ---------- panel window drag ----------
let panelDrag = false
let panelLastX = 0
let panelLastY = 0
let panelRaf = 0
let panelPendingDx = 0
let panelPendingDy = 0
function dragStart(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (el.closest('button, input, select, textarea')) return
  panelDrag = true
  panelLastX = e.screenX
  panelLastY = e.screenY
}
function dragMove(e: MouseEvent): void {
  if (!panelDrag || (e.buttons & 1) === 0) { if (!(e.buttons & 1)) panelDrag = false; return }
  const dx = e.screenX - panelLastX
  const dy = e.screenY - panelLastY
  panelLastX = e.screenX
  panelLastY = e.screenY
  panelPendingDx += dx
  panelPendingDy += dy
  if (!panelRaf) {
    panelRaf = requestAnimationFrame(() => {
      panelRaf = 0
      const fx = panelPendingDx
      const fy = panelPendingDy
      panelPendingDx = 0
      panelPendingDy = 0
      if (fx || fy) void window.lingban.window.moveBy(fx, fy)
    })
  }
}
function dragEnd(): void { panelDrag = false; if (panelRaf) { cancelAnimationFrame(panelRaf); panelRaf = 0 }; panelPendingDx = 0; panelPendingDy = 0 }

// ---------- tasks ----------
const newTitle = ref('')
const newTag = ref<'daily' | 'weekly' | 'once'>('daily')
const newEst = ref(25)
const newDays = ref(4)
const editingId = ref<string | null>(null)
const editTitle = ref('')

async function addTask(): Promise<void> {
  if (!newTitle.value.trim()) return
  await store.addTask({
    title: newTitle.value.trim(),
    tag: newTag.value,
    estimate_minutes: Number(newEst.value) || 25,
    estimate_days: newTag.value === 'once' ? Number(newDays.value) || 1 : undefined,
    weekly_times: newTag.value === 'weekly' ? 3 : undefined
  } as Partial<Task>)
  newTitle.value = ''
}

function startEdit(t: Task): void { editingId.value = t.id; editTitle.value = t.title }
async function saveEdit(t: Task): Promise<void> {
  if (editTitle.value.trim()) await window.lingban.tasks.update(t.id, { title: editTitle.value.trim() })
  editingId.value = null
  await store.refreshTasks()
}
async function deleteTask(t: Task): Promise<void> { await window.lingban.tasks.remove(t.id); await store.refreshTasks() }
async function reopen(t: Task): Promise<void> { await window.lingban.tasks.reopen(t.id); await store.refreshTasks() }

// ---------- diary ----------
const reflectionText = ref('')
watch(() => store.diary, (d) => { reflectionText.value = d?.reflection || '' })

async function saveDiary(): Promise<void> {
  await window.lingban.diary.saveReflection(store.diaryDate, reflectionText.value)
  await store.refreshDiary()
  store.toast = { title: '日记', body: '已保存 ✍️' }
  setTimeout(() => { store.toast = null }, 2000)
}

// ---------- timer ----------
const timerType = ref<FocusType>('pomodoro')
const timerDuration = ref(25)
const timerTask = ref('')
const activeTaskTitle = computed(() => {
  if (!store.timer.active?.task_id) return '未关联任务'
  const t = store.tasks.find(x => x.id === store.timer.active?.task_id)
  return t?.title || '未关联任务'
})

const displaySec = computed(() => {
  if (!store.timer.active) return 0
  return store.timer.remainingSec
})

async function startTimer(): Promise<void> {
  await window.lingban.timer.start({
    taskId: timerTask.value || null,
    type: timerType.value,
    durationSec: timerType.value === 'stopwatch' ? 0 : Number(timerDuration.value) * 60
  })
  await refreshTimer()
  await store.startTimerTick()
  await store.startStateLoop('focus')
}

async function refreshTimer(): Promise<void> {
  store.timer = await window.lingban.timer.getActive()
  await store.refreshStats()
}

async function stopTimer(): Promise<void> {
  if (!store.timer.active) return
  await window.lingban.timer.stop(store.timer.active.id)
  store.stopTimerTick()
  store.stopStateLoop(false)
  await refreshTimer()
}

async function cancelTimer(): Promise<void> {
  if (!store.timer.active) return
  await window.lingban.timer.cancel(store.timer.active.id)
  store.stopTimerTick()
  store.stopStateLoop(false)
  await refreshTimer()
}

// ---------- break mode ----------
const breakMode = ref(false)
function startBreak(): void {
  breakMode.value = true
  void store.startStateLoop('break')
}
function endBreak(): void {
  breakMode.value = false
  store.stopStateLoop(false)
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

// ---------- calendar ----------
function today(): string {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const weekStart = ref(today())
const weekDays = computed(() => {
  const base = new Date(weekStart.value + 'T00:00:00')
  const arr: { date: string; label: string; items: ScheduleItem[] }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i)
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    arr.push({ date: ds, label: '周' + '日一二三四五六'[d.getDay()], items: store.schedules.filter(s => s.date === ds) })
  }
  return arr
})

function weekEnd(): string {
  const d = new Date(weekStart.value + 'T00:00:00')
  d.setDate(d.getDate() + 6)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

async function refreshWeek(): Promise<void> { await store.loadWeek(weekStart.value, weekEnd()) }

const manualTaskId = ref('')
const manualDate = ref(today())
const manualStart = ref('09:00')
const manualEnd = ref('09:25')

function setManualDateFromWeek(): void { manualDate.value = weekStart.value }

async function addManual(): Promise<void> {
  if (!manualTaskId.value || !manualStart.value || !manualEnd.value) {
    store.toast = { title: '提示', body: '请选择任务并填写开始/结束时间' }
    setTimeout(() => { store.toast = null }, 2000)
    return
  }
  await window.lingban.schedule.addManual(manualDate.value, manualTaskId.value, manualStart.value, manualEnd.value)
  await refreshWeek()
  store.toast = { title: '已添加', body: '手动日程已确认' }
  setTimeout(() => { store.toast = null }, 2000)
}

async function removeSchedule(s: ScheduleItem): Promise<void> {
  await window.lingban.schedule.removeItem(s.id)
  await refreshWeek()
}

async function completeSchedule(s: ScheduleItem): Promise<void> {
  if (s.status === 'done') return
  await window.lingban.schedule.completeItem(s.id)
  await refreshWeek()
  await store.refreshStats()
}

async function generatePlan(): Promise<void> {
  store.toast = { title: '规划中', body: '灵伴思考ing…' }
  setTimeout(() => { store.toast = null }, 1200)
  await window.lingban.schedule.generateToday()
  await refreshWeek()
}

async function confirmPlan(): Promise<void> {
  await window.lingban.schedule.confirm(JSON.parse(JSON.stringify(store.schedules)))
  await refreshWeek()
}

async function saveSchedule(s: ScheduleItem): Promise<void> {
  await window.lingban.schedule.updateItem(s.id, { start_time: s.start_time, end_time: s.end_time })
  await store.refreshSchedules()
}

function shiftWeek(days: number): void {
  const d = new Date(weekStart.value + 'T00:00:00')
  d.setDate(d.getDate() + days)
  weekStart.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  void refreshWeek()
}

onMounted(async () => {
  window.addEventListener('mouseup', dragEnd)
  void store.startTimerTick()
  await refreshWeek()
  await store.refreshDiary()
  refreshText()
  void refreshTimer()
})

function refreshText(): void { reflectionText.value = store.diary?.reflection || '' }

onUnmounted(() => { window.removeEventListener('mouseup', dragEnd) })
</script>

<template>
  <div class="panel-overlay interactive">
    <div class="panel-card" @mousedown="dragStart" @mousemove="dragMove" @mouseup="dragEnd">
      <div class="panel-head">
        <span class="panel-title">灵伴 · 面板</span>
        <button class="close-btn" @click="close">✕</button>
      </div>
      <div class="panel-tabs">
        <button class="tab-btn" :class="{ active: tab === 'tasks' }" @click="tab = 'tasks'">📋 任务</button>
        <button class="tab-btn" :class="{ active: tab === 'diary' }" @click="tab = 'diary'">📖 日记</button>
        <button class="tab-btn" :class="{ active: tab === 'timer' }" @click="tab = 'timer'">⏱️ 计时</button>
        <button class="tab-btn" :class="{ active: tab === 'calendar' }" @click="tab = 'calendar'">📅 日历</button>
      </div>

      <!-- 任务 -->
      <div v-if="tab === 'tasks'">
        <div class="form-row">
          <input class="field" style="flex:1" v-model="newTitle" placeholder="新任务标题" @keyup.enter="addTask" />
          <select class="field" v-model="newTag">
            <option value="daily">每日</option>
            <option value="weekly">每周X次</option>
            <option value="once">一次性</option>
          </select>
          <input class="field" style="width:70px" type="number" min="5" v-model.number="newEst" />
          <button class="primary-btn" @click="addTask">添加</button>
        </div>
        <div class="task-row neu-inset" v-for="t in store.tasks" :key="t.id">
          <input class="checkbox" type="checkbox" :checked="t.status === 'completed'" @change="t.status === 'completed' ? reopen(t) : store.completeTask(t.id)" />
          <span class="task-title" :class="{ 'task-done': t.status === 'completed' }">
            <input v-if="editingId === t.id" class="field" v-model="editTitle" @keyup.enter="saveEdit(t)" />
            <template v-else>{{ t.title }}</template>
          </span>
          <span class="task-tag">{{ t.tag }}</span>
          <span v-if="t.tag === 'once'" class="task-tag">{{ t.progress }}%</span>
          <button class="icon-btn" :title="t.status === 'completed' ? '重新打开' : '标记完成'" @click="t.status === 'completed' ? reopen(t) : store.completeTask(t.id)">{{ t.status === 'completed' ? '↩' : '✅' }}</button>
          <button class="icon-btn" @click="editingId === t.id ? saveEdit(t) : startEdit(t)">{{ editingId === t.id ? '✓' : '✎' }}</button>
          <button class="icon-btn" @click="deleteTask(t)">🗑</button>
        </div>
      </div>

      <!-- 日记 -->
      <div v-if="tab === 'diary'">
        <div class="stat-line">📅 {{ store.diaryDate }} · 今日专注：{{ store.focusMinutes }} 分钟 · 完成任务：{{ store.doneTasks.length }}</div>
        <textarea class="diary-box" v-model="reflectionText" placeholder="写下今天的心情与反思…"></textarea>
        <div class="timer-control">
          <button class="primary-btn" @click="saveDiary">保存日记</button>
          <button class="primary-btn" @click="store.runReview()">AI 复盘</button>
        </div>
        <div v-if="store.reviewResult" class="neu" style="padding:12px;margin-top:12px">
          <div style="font-weight:700">复盘评分：{{ store.reviewResult.score }} 分</div>
          <div style="font-size:13px;color:#5b6a8c;margin-top:6px">{{ store.reviewResult.comment }}</div>
        </div>
      </div>

      <!-- 计时 -->
      <div v-if="tab === 'timer'">
        <div class="timer-stage">
          <div class="timer-ring"><div class="timer-time">{{ fmt(displaySec) }}</div></div>
          <div class="stat-line" style="margin-top:10px">{{ store.timer.active ? '进行中 · ' + activeTaskTitle : '未开始' }}</div>
          <div class="timer-control">
            <select class="field" v-model="timerType" :disabled="!!store.timer.active">
              <option value="pomodoro">番茄钟</option>
              <option value="countdown">倒计时</option>
              <option value="stopwatch">正计时</option>
            </select>
            <input class="field" style="width:80px" type="number" v-model.number="timerDuration" :disabled="timerType === 'stopwatch' || !!store.timer.active" /> 分钟
            <select class="field" v-model="timerTask" :disabled="!!store.timer.active">
              <option value="">不关联任务</option>
              <option v-for="t in store.activeTasks" :key="t.id" :value="t.id">{{ t.title }}</option>
            </select>
          </div>
          <div class="timer-control">
            <button class="primary-btn" v-if="!store.timer.active && !breakMode" @click="startTimer">开始</button>
            <button class="primary-btn" v-if="store.timer.active" @click="stopTimer">结束</button>
            <button class="primary-btn" v-if="store.timer.active" @click="cancelTimer">取消</button>
            <button class="primary-btn" v-if="!store.timer.active && !breakMode" @click="startBreak">🌿 休息模式</button>
            <button class="primary-btn" v-if="breakMode" @click="endBreak">结束休息</button>
          </div>
          <div v-if="breakMode" class="stat-line">休息中… 灵伴陪你放松一下</div>
        </div>
      </div>

      <!-- 日历 -->
      <div v-if="tab === 'calendar'">
        <div class="form-row">
          <button class="primary-btn" @click="shiftWeek(-7)">◀ 上周</button>
          <span class="stat-line" style="flex:1;text-align:center">{{ weekDays[0].date }} ~ {{ weekDays[6].date }}</span>
          <button class="primary-btn" @click="shiftWeek(7)">下周 ▶</button>
        </div>
        <div class="timer-control" style="margin-bottom:10px">
          <button class="primary-btn" @click="generatePlan">🤖 生成今日计划</button>
          <button class="primary-btn" @click="confirmPlan">✓ 确认日程</button>
        </div>

        <div class="neu-inset" style="padding:10px;margin-bottom:10px">
          <div class="form-row">
            <select class="field" v-model="manualDate" style="flex:1">
              <option v-for="d in weekDays" :key="d.date" :value="d.date">{{ d.label }} {{ d.date.slice(5) }}</option>
            </select>
            <select class="field" v-model="manualTaskId" style="flex:1.4">
              <option value="">选择任务…</option>
              <option v-for="t in store.activeTasks" :key="t.id" :value="t.id">{{ t.title }}</option>
            </select>
            <input class="field time-input" type="time" v-model="manualStart" />
            <span>–</span>
            <input class="field time-input" type="time" v-model="manualEnd" />
            <button class="primary-btn" @click="addManual">+ 手动安排</button>
          </div>
        </div>
        <div class="week-agenda">
          <div v-for="d in weekDays" :key="d.date" class="cal-day-section" :class="{ today: d.date === today() }">
            <div class="cal-day-header">
              <span class="cal-day-title">{{ d.label }} · {{ d.date.slice(5) }}</span>
              <span class="cal-day-count">{{ d.items.length }} 项</span>
            </div>
            <div v-if="!d.items.length" class="cal-empty">暂无日程</div>
            <div v-for="s in d.items" :key="s.id" class="cal-item">
              <div class="cal-item-time">
                <input class="field time-input" type="time" v-model="s.start_time" @change="saveSchedule(s)" />
                <span>–</span>
                <input class="field time-input" type="time" v-model="s.end_time" @change="saveSchedule(s)" />
              </div>
              <div class="cal-item-info">
                <span class="cal-item-title">{{ s.task_title || s.task_id }}</span>
                <span class="cal-item-status" :class="'st-' + s.status">{{ s.status }}</span>
                <button class="icon-btn" :title="s.status === 'done' ? '已完成' : '标记当日完成'" @click="completeSchedule(s)">{{ s.status === 'done' ? '✓' : '✅' }}</button>
                <button class="icon-btn" title="删除日程" @click="removeSchedule(s)">🗑</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>