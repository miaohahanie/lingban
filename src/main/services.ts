import { app, BrowserWindow, Notification, dialog, shell, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { DB } from './db'
import type {
  Task, ScheduleItem, FocusSession, FocusStartInput, DiaryEntry, Memory, PetAsset, PetAnimationEvent,
  Emotion, ReviewResult, CommandResult, PanelName, Quote, AppMap
} from '../shared/types'

const BUILTIN_ALIASES: Record<string, { target: string; type: 'url' | 'app' }> = {
  bilibili: { target: 'https://www.bilibili.com', type: 'url' },
  '哔哩哔哩': { target: 'https://www.bilibili.com', type: 'url' },
  知乎: { target: 'https://www.zhihu.com', type: 'url' },
  zhihu: { target: 'https://www.zhihu.com', type: 'url' },
  微博: { target: 'https://weibo.com', type: 'url' },
  weibo: { target: 'https://weibo.com', type: 'url' },
  github: { target: 'https://github.com', type: 'url' },
  'GitHub': { target: 'https://github.com', type: 'url' },
  chatgpt: { target: 'https://chat.openai.com', type: 'url' },
  deepseek: { target: 'https://chat.deepseek.com', type: 'url' },
  'DeepSeek': { target: 'https://chat.deepseek.com', type: 'url' },
  ds: { target: 'https://chat.deepseek.com', type: 'url' },
  localhost: { target: 'http://localhost', type: 'url' }
}

function now(): number { return Date.now() }
function localDate(d: Date = new Date()): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function hm(d: Date = new Date()): string {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function addMinutes(time: string, min: number): string {
  const parts = time.split(':')
  const total = Number(parts[0]) * 60 + Number(parts[1]) + min
  return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}
function randomOf<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

function parseLLMJson(text: string): unknown {
  const cleaned = text.replace(/\`\`\`json|\`\`\`/g, '').trim()
  try { return JSON.parse(cleaned) } catch { /* continue */ }
  const objStart = cleaned.indexOf('{')
  const objEnd = cleaned.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    try { return JSON.parse(cleaned.slice(objStart, objEnd + 1)) } catch { /* continue */ }
  }
  const arrStart = cleaned.indexOf('[')
  const arrEnd = cleaned.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    try { return JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) } catch { /* ignore */ }
  }
  return null
}

export class Services {
  private db: DB
  private win: BrowserWindow | null
  private manifest: PetAsset[] = []
  private cooldowns = new Map<string, number>()
  private lastSignals = new Map<string, string>()
  private emotion: Emotion = 'calm'
  private emotionUpdatedAt = now()
  private schedulerTimer: NodeJS.Timeout | null = null
  private morningFocusShown = false
  private clickCount = 0

  constructor(db: DB, win: BrowserWindow | null) {
    this.db = db
    this.win = win
    this.loadManifest()
    this.emotion = db.getSetting<Emotion>('emotion_state', 'calm')
    this.emotionUpdatedAt = db.getSetting<number>('emotion_updated_at', now())
  }

  setWindow(win: BrowserWindow | null): void { this.win = win }

  // ---------- manifest / assets ----------
  private assetsDir(): string {
    const candidates = [
      app.isPackaged ? path.join(process.resourcesPath, 'pet-anims') : path.join(app.getAppPath(), 'resources', 'pet-anims'),
      path.join(app.getAppPath(), 'resources', 'pet-anims'),
      path.join(__dirname, '../../resources/pet-anims')
    ]
    for (const c of candidates) { if (fs.existsSync(path.join(c, 'manifest.json'))) return c }
    return candidates[0]
  }

  private loadManifest(): void {
    try {
      const p = path.join(this.assetsDir(), 'manifest.json')
      this.manifest = JSON.parse(fs.readFileSync(p, 'utf8')) as PetAsset[]
    } catch {
      this.manifest = []
    }
  }

  getManifest(): PetAsset[] { return this.manifest }

  getAsset(file: string): string {
    const p = path.join(this.assetsDir(), file)
    if (!fs.existsSync(p)) return ''
    const buf = fs.readFileSync(p)
    return 'data:image/gif;base64,' + buf.toString('base64')
  }

  // ---------- settings ----------
  getSetting<T = unknown>(key: string, def: T): T { return this.db.getSetting(key, def) }
  setSetting(key: string, value: unknown): void { this.db.setSetting(key, value) }
  getAllSettings(): Record<string, unknown> { return this.db.getAllSettings() }

  getAnimationEnabled(): boolean { return this.getSetting<boolean>('pet_animation_enabled', true) }
  private getPlayfulEnabled(): boolean { return this.getSetting<boolean>('pet_playful_enabled', true) }
  setAnimationEnabled(v: boolean): void { this.setSetting('pet_animation_enabled', v) }

  // ---------- emotion ----------
  setEmotion(e: Emotion): void {
    this.emotion = e
    this.emotionUpdatedAt = now()
    this.db.setSetting('emotion_state', e)
    this.db.setSetting('emotion_updated_at', this.emotionUpdatedAt)
    this.send('pet:emotion', e)
  }
  getEmotion(): Emotion {
    if (now() - this.emotionUpdatedAt > 6 * 3600 * 1000) return 'calm'
    return this.emotion
  }
  notifyEmotion(event: string): void {
    if (event === 'task_complete') this.setEmotion('happy')
    else if (event === 'overdue') this.setEmotion('worried')
    else if (event === 'night_focus') this.setEmotion('sympathetic')
    else if (event === 'focus_goal') this.setEmotion('admiring')
    else if (event === 'idle') this.setEmotion('calm')
  }

  // ---------- animation ----------
  eventToAssetId(event: string, context?: Record<string, unknown>): string | null {
    const hour = context && context.hour != null ? Number(context.hour) : new Date().getHours()
    const map: Record<string, string[]> = {
      morning: ['greeting_good_morning'],
      app_start: ['greeting_appear'],
      focus_start: (hour < 12 && !this.morningFocusShown) ? ['focus_morning'] : ['focus_working'],
      task_start: ['cheer_go'],
      task_complete: ['praise_amazing', 'praise_done'],
      focus_end: ['praise_done', 'praise_amazing'],
      break_start: ['break_resting'],
      care_noon: ['care_eat'],
      evening: ['break_resting'],
      night: ['health_overtime', 'relax_calm'],
      overdue: ['relax_calm'],
      birthday: ['birthday_cake'],
      plan_start: ['planning_thinking'],
      plan_done: ['playful_idea'],
      plan_fail: ['relax_calm'],
      review_start: ['recording_writing'],
      review_done: ['praise_amazing', 'relax_calm'],
      recording: ['recording_writing'],
      overload: ['overload_gentleman'],
      health_dizzy: ['health_dizzy'],
      idle: ['playful_phone', 'playful_wink'],
      click: [],
      day7: ['affection_love']
    }
    if (event === 'click') {
      const pool = ['playful_wink', 'praise_done', 'affection_love', 'greeting_appear', 'playful_idea']
      return pool[this.clickCount++ % pool.length]
    }
    const ids = map[event]
    if (!ids) return null
    return randomOf(ids)
  }

  private canPlay(assetId: string): boolean {
    const asset = this.manifest.find(a => a.assetId === assetId)
    if (!asset) return false
    if (asset.category === 'playful' && !this.getPlayfulEnabled()) return false
    const last = this.cooldowns.get(assetId) || 0
    return now() - last >= asset.cooldownMin * 60 * 1000
  }

  trigger(event: string, context?: Record<string, unknown>): PetAnimationEvent | null {
    if (!this.getAnimationEnabled()) return null
    const assetId = this.eventToAssetId(event, context)
    if (!assetId) return null
    if (event !== 'click' && !this.canPlay(assetId)) return null
    const asset = this.manifest.find(a => a.assetId === assetId)
    if (!asset) return null
    this.cooldowns.set(assetId, now())
    if (event === 'focus_start' && assetId === 'focus_morning') this.morningFocusShown = true
    return { assetId, caption: asset.caption, loop: asset.loop }
  }

  async preview(name?: string): Promise<PetAnimationEvent | null> {
    if (!this.getAnimationEnabled()) return null
    let asset: PetAsset | undefined
    if (name) asset = this.manifest.find(a => a.assetId === name || a.file.includes(name) || a.caption.includes(name))
    if (!asset) asset = randomOf(this.manifest)
    if (!asset) return null
    this.cooldowns.set(asset.assetId, now())
    return { assetId: asset.assetId, caption: asset.caption, loop: asset.loop }
  }

  // ---------- notify / window ----------
  private send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }
  async notify(title: string, body: string, event?: string): Promise<void> {
    const anim = event ? this.trigger(event) : null
    this.send('pet:notify', { title, body, animation: anim })
    if (this.getSetting<boolean>('system_notifications', true)) {
      try { new Notification({ title, body }).show() } catch { /* ignore */ }
    }
  }
  openPanel(name: PanelName): void { this.send('pet:openPanel', name) }

  // ---------- onboarding ----------
  isOnboardingDone(): boolean { return this.getSetting<boolean>('onboarding_done', false) }
  async completeOnboarding(data: {
    autostart: boolean
    autoPlan: boolean
    workDays: number[]
    workHours: { dayOfWeek: number; startHour: number; endHour: number }[]
    apiKey?: string
    tasks: { title: string; tag: Task['tag']; estimateMinutes?: number; estimateDays?: number; weeklyTimes?: number }[]
    birthday?: string
  }): Promise<void> {
    this.db.setWorkDays(data.workDays.length ? data.workDays : [1, 2, 3, 4, 5])
    this.db.setWorkHours(data.workHours.length ? data.workHours : [{ dayOfWeek: -1, startHour: 9, endHour: 18 }])
    const existingTitles = new Set(this.db.listTasks().map(t => t.title.trim().toLowerCase()))
    for (const t of data.tasks) {
      const key = t.title.trim().toLowerCase()
      if (existingTitles.has(key)) continue
      this.db.createTask({
        title: t.title,
        tag: t.tag,
        estimate_minutes: t.estimateMinutes ?? 25,
        estimate_days: t.estimateDays,
        weekly_times: t.weeklyTimes
      })
      existingTitles.add(key)
    }
    if (data.apiKey) this.setApiKey(data.apiKey)
    if (data.birthday) this.setSetting('birthday', data.birthday)
    this.setSetting('autostart', data.autostart)
    this.setSetting('auto_plan', data.autoPlan)
    this.setSetting('onboarding_done', true)
    this.setSetting('first_used_at', now())
    try { app.setLoginItemSettings({ openAtLogin: !!data.autostart }) } catch { /* ignore */ }
  }
  reset(): void {
    for (const key of ['onboarding_done', 'work_days', 'work_hours', 'care_times', 'autostart', 'auto_plan', 'birthday', 'pet_animation_enabled', 'pet_playful_enabled', 'pet_low_power_mode', 'emotion_state', 'emotion_updated_at']) {
      this.db.setSetting(key, null)
    }
    this.db.setWorkDays([1, 2, 3, 4, 5])
    this.db.setWorkHours([{ dayOfWeek: -1, startHour: 9, endHour: 18 }])
    this.db.setSetting('onboarding_done', false)
  }

  // ---------- AI / DeepSeek ----------
  private keyPath(): string { return path.join(app.getPath('userData'), 'secure', 'apikey.bin') }
  setApiKey(key: string): void {
    try {
      const buf = safeStorage.encryptString(key)
      fs.writeFileSync(this.keyPath(), buf)
    } catch {
      fs.writeFileSync(this.keyPath(), Buffer.from('PLAIN:' + key, 'utf8'))
    }
  }
  clearApiKey(): void {
    try { fs.unlinkSync(this.keyPath()) } catch { /* ignore */ }
  }
  getApiKey(): string | null {
    try {
      if (!fs.existsSync(this.keyPath())) return null
      const raw = fs.readFileSync(this.keyPath())
      const s = raw.toString('utf8')
      if (s.startsWith('PLAIN:')) return s.slice(6)
      if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(raw)
      return s
    } catch { return null }
  }
  async testKey(key: string): Promise<boolean> {
    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(10000)
      })
      return r.ok
    } catch { return false }
  }
  private async aiChat(messages: { role: string; content: string }[], json = false, temperature = 0.8, maxTokens?: number): Promise<string | null> {
    const key = this.getApiKey()
    if (!key) return null
    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: this.getSetting<string>('model', 'deepseek-chat'),
          messages,
          temperature,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          ...(json ? { response_format: { type: 'json_object' } } : {})
        }),
        signal: AbortSignal.timeout(30000)
      })
      if (!r.ok) return null
      const data = await r.json()
      return data?.choices?.[0]?.message?.content ?? null
    } catch { return null }
  }

  // ---------- tasks ----------
  listTasks(): Task[] { return this.db.listTasks() }
  createTask(input: Partial<Task>): Task { return this.db.createTask(input) }
  updateTask(id: string, patch: Partial<Task>): Task { return this.db.updateTask(id, patch) }
  deleteTask(id: string): void { this.db.deleteTask(id) }
  completeTask(id: string): Task {
    const task = this.db.completeTask(id)
    const date = localDate()
    for (const s of this.db.getSchedulesByDate(date)) {
      if (s.task_id === id && (s.status === 'confirmed' || s.status === 'planned')) {
        this.db.updateSchedule(s.id, { status: 'done' })
      }
    }
    this.db.addDiaryCompletion(localDate(), task.title)
    this.notifyEmotion('task_complete')
    const anim = this.trigger('task_complete')
    this.send('pet:play', anim)
    this.db.updateDiaryFocus(localDate(), this.db.focusStatsToday().totalSec)
    return task
  }
  reopenTask(id: string): Task { return this.db.reopenTask(id) }
  archiveTask(id: string): Task { return this.db.archiveTask(id) }
  reorderTasks(ids: string[]): void { this.db.reorderTasks(ids) }

  // ---------- schedule / planning ----------
  getSchedulesByDate(date: string): ScheduleItem[] { return this.db.getSchedulesByDate(date) }
  getSchedulesRange(start: string, end: string): ScheduleItem[] { return this.db.getSchedulesBetween(start, end) }

  private localPlan(date: string): ScheduleItem[] {
    const dow = new Date(date + 'T00:00:00').getDay()
    const workDays = this.db.getWorkDays()
    if (workDays.length && !workDays.includes(dow)) return []
    const hours = this.db.getWorkHours().filter(h => h.dayOfWeek === -1 || h.dayOfWeek === dow).sort((a, b) => a.startHour - b.startHour)
    const segs = hours.length ? hours : [{ startHour: 9, endHour: 18 }]
    const tasks = this.db.listTasks().filter(t => t.status === 'active')
    const items: ScheduleItem[] = []
    if (!tasks.length) return items
    const queue = [...tasks]
    const counts: Record<string, number> = {}
    let qi = 0
    for (const seg of segs) {
      let cursor = seg.startHour * 60
      const endMin = seg.endHour * 60
      while (cursor < endMin) {
        const guard = qi
        const t = queue[qi % queue.length]
        if ((counts[t.id] || 0) >= 2) {
          qi++
          if (qi - guard > queue.length * 2) break
          continue
        }
        const dur = Math.max(15, Math.min(120, t.estimate_minutes || 25))
        if (cursor + dur > endMin) break
        const start = String(Math.floor(cursor / 60)).padStart(2, '0') + ':' + String(cursor % 60).padStart(2, '0')
        const end = String(Math.floor((cursor + dur) / 60)).padStart(2, '0') + ':' + String((cursor + dur) % 60).padStart(2, '0')
        items.push({ id: randomUUID(), date, task_id: t.id, start_time: start, end_time: end, status: 'planned', manual: 0, created_at: 0, task_title: t.title, task_tag: t.tag, estimate_minutes: dur })
        counts[t.id] = (counts[t.id] || 0) + 1
        cursor += dur + 10
        qi++
      }
    }
    return items
  }

  async generatePlan(): Promise<ScheduleItem[]> {
    const date = localDate()
    const existing = this.db.getSchedulesByDate(date).filter(s => s.status === 'confirmed' || s.status === 'done')
    if (existing.length) return existing
    this.db.deleteSchedulesByDate(date)
    const tasks = this.db.listTasks()
    const ctx = tasks.map(t => ({ id: t.id, title: t.title, tag: t.tag, est: t.estimate_minutes }))
    let items: ScheduleItem[] | null = null
    const key = this.getApiKey()
    if (key) {
      this.trigger('plan_start')
      const system = '你是灵伴的智能日程规划引擎。你只能输出一个 JSON 对象，禁止输出解释、Markdown 或代码块。JSON 格式必须为 {"schedules":[{"taskId":"任务ID","start":"HH:mm","end":"HH:mm"}]}。排期规则：(1) 只在用户工作时段内排期；(2) 每段时间 15-120 分钟；(3) 任务不重叠，相邻任务之间留 5-10 分钟缓冲；(4) 尽量填满工作时段，但同一任务在同一天最多重复 2 次，不要机械重复；(5) 优先级：daily > weekly（本周还需完成的次数）> once；(6) 任务总时长不超出当天工作时段；(7) 如果时间不够，按优先级排，排不下的列入 "unscheduled" 数组并说明原因；(8) 所有 taskId 必须来源于输入数据。'
      const prompt = {
        date,
        workHours: this.db.getWorkHours(),
        tasks: ctx
      }
      const raw = await this.aiChat([
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(prompt) }
      ], true, 0.3, 2048)
      if (raw) {
        try {
          const parsed = parseLLMJson(raw) as { schedules?: { taskId: string; start: string; end: string }[]; items?: unknown[]; unscheduled?: unknown[] } | { taskId: string; start: string; end: string }[] | null
          const arr = Array.isArray(parsed) ? parsed : (parsed?.schedules || parsed?.items || [])
          const valid = Array.isArray(arr) && arr.length > 0 && (arr as { taskId?: string; start?: string; end?: string }[]).every((it) => !!(it && it.taskId && it.start && it.end))
          if (valid) {
            items = (arr as { taskId: string; start: string; end: string }[]).map((it) => ({
              id: randomUUID(), date, task_id: it.taskId, start_time: it.start, end_time: it.end,
              status: 'planned' as const, manual: 0, created_at: 0
            })).filter((it: ScheduleItem) => tasks.some(t => t.id === it.task_id))
          } else {
            items = null
          }
        } catch { items = null }
      }
    }
    if (!items) {
      items = this.localPlan(date)
      const failKey = 'plan_fail:' + date
      if (this.lastSignals.get(failKey) !== date) {
        this.lastSignals.set(failKey, date)
        void this.notify('AI 规划未成功', '已用本地规划生成今日日程；请在设置中检查 API Key / 网络连接。')
      }
    }
    const saved = this.db.upsertSchedules(items)
    const cheer = this.trigger('plan_done')
    if (saved.length) {
      this.send('pet:play', cheer
        ? { ...cheer, caption: '今日计划生成好啦，主人加油！' }
        : { assetId: 'praise_done', caption: '今日计划生成好啦，主人加油！', loop: false })
    }
    return saved
  }

  async confirmSchedules(items: ScheduleItem[]): Promise<void> {
    for (const it of items) this.db.updateSchedule(it.id, { status: 'confirmed' })
  }
  addManualSchedule(date: string, taskId: string, start: string, end: string): ScheduleItem[] {
    return this.db.upsertSchedules([{
      id: randomUUID(), date, task_id: taskId, start_time: start, end_time: end,
      status: 'confirmed', manual: 1
    }])
  }
  updateSchedule(id: string, patch: Partial<ScheduleItem>): void { this.db.updateSchedule(id, patch) }
  removeSchedule(id: string): void { this.db.deleteSchedule(id) }
  completeSchedule(id: string): void {
    const date = localDate()
    const s = this.db.getSchedulesByDate(date).find(x => x.id === id)
    if (!s) return
    this.db.updateSchedule(id, { status: 'done' })
    const task = this.db.getTask(s.task_id)
    if (task) this.db.addDiaryCompletion(date, task.title)
    this.notifyEmotion('task_complete')
    const anim = this.trigger('task_complete')
    this.send('pet:play', anim)
  }
  async rePlanWeek(): Promise<void> {
    const today = new Date()
    const monday = new Date(today)
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i)
      const ds = localDate(d)
      for (const s of this.db.getSchedulesByDate(ds)) this.db.deleteSchedule(s.id)
      const plan = this.localPlan(ds)
      this.db.upsertSchedules(plan)
    }
  }

  // ---------- focus ----------
  startFocus(input: FocusStartInput): FocusSession {
    const running = this.db.getRunningFocus()
    if (running) this.db.stopFocus(running.id, Math.floor((now() - running.started_at) / 1000), true)
    const task = input.taskId ? this.db.getTask(input.taskId) : null
    const durationSec = input.durationSec || (input.type === 'countdown' ? 25 * 60 : input.type === 'pomodoro' ? 25 * 60 : 0)
    const note = input.type === 'stopwatch' ? null : JSON.stringify({ durationSec })
    const s = this.db.startFocus({ taskId: input.taskId, type: input.type })
    this.db.setFocusNote(s.id, note)
    if (task?.file_path) {
      setTimeout(() => { void this.openPath(task.file_path as string) }, 300)
    }
    this.notifyEmotion('focus_start')
    const anim = this.trigger('focus_start', { hour: new Date().getHours() })
    this.send('pet:play', anim)
    return s
  }
  stopFocus(id: string): FocusSession {
    const s = this.db.stopFocus(id, Math.max(0, Math.floor((now() - this.sessionStartAt(id)) / 1000)))
    this.db.updateDiaryFocus(localDate(), this.db.focusStatsToday().totalSec)
    this.notifyEmotion('focus_end')
    const anim = this.trigger('focus_end')
    this.send('pet:play', anim)
    return s
  }
  cancelFocus(id: string): FocusSession {
    const s = this.db.stopFocus(id, 0, true)
    this.db.updateDiaryFocus(localDate(), this.db.focusStatsToday().totalSec)
    return s
  }
  getActiveTimer(): { active: FocusSession | null; remainingSec: number } {
    const s = this.db.getRunningFocus()
    if (!s) return { active: null, remainingSec: 0 }
    let remaining = 0
    if (s.note) {
      try {
        const note = JSON.parse(s.note) as { durationSec?: number }
        const total = note.durationSec || 0
        remaining = Math.max(0, total - Math.floor((now() - s.started_at) / 1000))
      } catch { /* ignore */ }
    }
    return { active: s, remainingSec: remaining }
  }
  private sessionStartAt(id: string): number {
    const s = this.db.getFocusSession(id)
    return s ? s.started_at : now()
  }
  listFocusToday(): FocusSession[] { return this.db.listFocusToday() }
  focusStats(): { totalSec: number; sessions: number } { return this.db.focusStatsToday() }

  // ---------- diary / memory / review ----------
  getDiary(date: string): DiaryEntry | null { return this.db.getDiary(date) }
  saveReflection(date: string, text: string): DiaryEntry { return this.db.saveReflection(date, text) }
  getDiaryRange(start: string, end: string): DiaryEntry[] { return this.db.getDiaryRange(start, end) }

  async generateMemory(): Promise<Memory | null> {
    const date = localDate()
    const diary = this.db.getDiary(date)
    const stats = this.db.focusStatsToday()
    const done = this.db.getSchedulesByDate(date).filter(s => s.status === 'done').length
    let summary: string | null = null
    const key = this.getApiKey()
    if (key) {
      const raw = await this.aiChat([{ role: 'system', content: '你为桌宠灵伴总结主人一天的日记记忆，输出一句话，不超过50字，亲切温柔。' }, { role: 'user', content: JSON.stringify({ date, tasks: diary?.task_summary || '', focusMin: Math.round(stats.totalSec / 60), reflection: diary?.reflection || '' }) }])
      if (raw) summary = raw.trim().replace(/^["']|["']$/g, '').slice(0, 200)
    }
    if (!summary) {
      summary = date + '：完成了' + done + '个任务，专注' + Math.round(stats.totalSec / 60) + '分钟。主人辛苦啦~'
    }
    return this.db.upsertMemory(date, summary)
  }

  async review(date: string): Promise<ReviewResult | null> {
    const diary = this.db.getDiary(date)
    const stats = this.db.focusStatsToday()
    const schedules = this.db.getSchedulesByDate(date)
    const confirmed = schedules.filter(s => s.status === 'confirmed' || s.status === 'done' || s.status === 'missed' || s.status === 'skipped')
    const doneCount = schedules.filter(s => s.status === 'done').length
    const completion = confirmed.length ? doneCount / confirmed.length : 0
    const goalSec = Number(this.getSetting<number>('daily_focus_target_sec', 4 * 3600))
    const focusRate = Math.min(1, stats.totalSec / Math.max(1, goalSec))
    const reflectionScore = diary?.reflection ? Math.min(100, diary.reflection.length * 2) : 0
    const persistScore = Math.min(100, Math.round(completion * 100))
    const raw = (0.4 * completion * 100) + (0.3 * focusRate * 100) + (0.2 * reflectionScore) + (0.1 * persistScore)
    let score = Math.max(0, Math.min(100, Math.round(raw)))
    let comment = ''
    const key = this.getApiKey()
    if (key) {
      const aiRaw = await this.aiChat([{ role: 'system', content: '你是桌宠灵伴，负责给主人做一日复盘。输出JSON {"score":0-100,"comment":"犀利且温柔的评语，先肯定再给1个改进点，60-120字"}。' }, { role: 'user', content: JSON.stringify({ date, completion, focusMin: Math.round(stats.totalSec / 60), reflection: diary?.reflection || '', baseScore: score }) }], true)
      if (aiRaw) {
        try {
          const parsed = JSON.parse(aiRaw)
          score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || score)))
          comment = String(parsed.comment || '')
        } catch { /* fallback */ }
      }
    }
    if (!comment) {
      comment = score >= 85
        ? '主人今天很棒！完成' + doneCount + '个任务，专注了' + Math.round(stats.totalSec / 60) + '分钟，继续保持这个节奏哦~'
        : score >= 60
          ? '今天' + doneCount + '个任务落地，专注' + Math.round(stats.totalSec / 60) + '分钟，整体不错；明天可以试着把最难的任务放在早上。'
          : '今天有点小疲惫呢～先拥抱自己，明天从最容易的一件小事开始，我会一直陪着主人的。'
    }
    this.db.saveReview(date, score, comment)
    this.notifyEmotion(score >= 85 ? 'focus_goal' : 'idle')
    return { score, comment }
  }

  async chat(text: string): Promise<string | null> {
    const key = this.getApiKey()
    const mood = this.getEmotion()
    const memories = this.db.listMemories().slice(0, 3)
    if (key) {
      const raw = await this.aiChat([
        { role: 'system', content: '你是桌宠灵伴，一个温柔贴心的女仆系AI桌面伴侣，称呼用户为“主人”。当前情绪：' + mood + '。最近记忆：' + memories.map(m => m.summary).join('；') + '。回复1-3句，简短温暖，符合人设。' },
        { role: 'user', content: text }
      ])
      if (raw) return raw
    }
    const qs = this.db.listQuotes().filter(q => q.enabled === 1)
    const pool = qs.length ? qs : [
      { text: '主人找我啦！我在呢~', category: 'random' },
      { text: '先喝口水再继续吧~', category: 'care' },
      { text: '今天也要加油哦！', category: 'cheer' }
    ]
    return randomOf(pool).text
  }

  // ---------- memo / quotes / map ----------
  listMemos() { return this.db.listMemos() }
  addMemo(content: string) { return this.db.addMemo(content) }
  removeMemo(id: string) { return this.db.removeMemo(id) }
  listQuotes(): Quote[] { return this.db.listQuotes() }
  addQuote(q: Partial<Quote>): Quote { return this.db.addQuote(q) }
  updateQuote(id: string, patch: Partial<Quote>): void { this.db.updateQuote(id, patch) }
  deleteQuote(id: string): void { this.db.deleteQuote(id) }
  toggleQuote(id: string): void {
    const q = this.db.listQuotes().find(x => x.id === id)
    if (q) this.db.updateQuote(id, { enabled: q.enabled === 1 ? 0 : 1 })
  }
  listAppMaps(): AppMap[] { return this.db.listAppMaps() }
  addAppMap(alias: string, target: string, type: AppMap['type']): AppMap { return this.db.addAppMap(alias, target, type) }
  deleteAppMap(id: string): void { this.db.deleteAppMap(id) }

  // ---------- open ----------
  async openUrl(url: string): Promise<boolean> {
    try { await shell.openExternal(url); return true } catch { return false }
  }
  async openPath(p: string): Promise<boolean> {
    try { const err = await shell.openPath(p); return !err } catch { return false }
  }
  async openApp(p: string): Promise<boolean> { return this.openPath(p) }

  // ---------- commands ----------
  async executeCommand(input: string): Promise<CommandResult> {
    const raw = input.trim()
    if (!raw) return { ok: false, message: '请输入内容' }
    if (!raw.startsWith('/')) {
      const text = await this.chat(raw)
      this.send('pet:chatReply', text)
      return { ok: true, action: 'chat', message: text || '' }
    }
    this.db.addCommandHistory(raw)
    const parts = raw.slice(1).split(/\s+/)
    let cmd = parts[0]
    let arg = parts.slice(1).join(' ')
    if (parts.length === 1) {
      if (cmd.startsWith('打开') && cmd.length > 2) { arg = cmd.slice(2); cmd = '打开' }
      else if (cmd.startsWith('写日记') && cmd.length > 3) { arg = cmd.slice(3); cmd = '写日记' }
      else if (cmd.startsWith('写入备忘录') && cmd.length > 5) { arg = cmd.slice(5); cmd = '写入备忘录' }
      else if (cmd.startsWith('动画') && cmd.length > 2) { arg = cmd.slice(2); cmd = '动画' }
    }
    const panelMap: Record<string, PanelName> = { '任务': 'tasks', '日记': 'diary', '计时': 'timer', '日历': 'calendar' }
    if (cmd === 'help' || cmd === '帮助') {
      const list = ['/任务', '/日记', '/计时', '/日历', '/打开 bilibili', '/打开 deepseek', '/复盘', '/写日记 内容', '/写入备忘录 内容', '/动画 素材名', '/自定义言语', '/清空回收站']
      return { ok: true, action: 'help', message: '预设指令：' + list.join('  ') }
    }
    if (panelMap[cmd]) {
      this.openPanel(panelMap[cmd])
      return { ok: true, action: 'panel:' + panelMap[cmd], message: '已打开面板' }
    }
    if (cmd === '打开') {
      if (!arg) return { ok: false, message: '请提供别名，如 /打开 bilibili' }
      const alias = BUILTIN_ALIASES[arg] || this.db.listAppMaps().find(m => m.alias === arg)
      let target: string | null = null
      let type: 'url' | 'app' = 'url'
      if (alias) {
        target = (alias as { target: string }).target
        type = (alias as { type: string }).type === 'url' ? 'url' : 'app'
      } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
        target = arg
      } else if (fs.existsSync(arg)) {
        target = arg
        type = 'app'
      }
      if (!target) return { ok: false, message: '找不到映射「' + arg + '」，可用 /动画、/任务 等指令，或在设置中配置别名' }
      if (type === 'url') await this.openUrl(target)
      else await this.openApp(target)
      return { ok: true, action: 'open', message: '已打开 ' + arg }
    }
    if (cmd === '清空回收站') {
      const win = this.win || undefined
      const { response } = win ? await dialog.showMessageBox(win, { type: 'warning', title: '清空回收站', message: '确定清空回收站吗？此操作不可恢复', buttons: ['取消', '确定'], defaultId: 0, cancelId: 0 }) : { response: 0 }
      if (response !== 1) return { ok: false, message: '已取消' }
      const { execFile } = await import('child_process')
      execFile('powershell.exe', ['-NoProfile', '-Command', 'Clear-RecycleBin -Force'], () => {})
      return { ok: true, message: '回收站已清空' }
    }
    if (cmd === '写日记') {
      const date = localDate()
      if (arg) {
        const e = this.db.ensureDiary(date)
        this.db.saveReflection(date, (e.reflection || '') + (e.reflection ? '\n' : '') + arg)
      }
      this.openPanel('diary')
      return { ok: true, action: 'panel:diary', message: '已写入日记' }
    }
    if (cmd === '写入备忘录') {
      if (!arg) return { ok: false, message: '请提供内容，如 /写入备忘录 买牛奶' }
      this.db.addMemo(arg)
      return { ok: true, action: 'memo', message: '已记入备忘录' }
    }
    if (cmd === '复盘') {
      const result = await this.review(localDate())
      this.send('pet:review', result)
      return { ok: true, action: 'review', message: result ? '复盘完成：' + result.score + '分' : '复盘失败' }
    }
    if (cmd === '动画') {
      const anim = await this.preview(arg || undefined)
      this.send('pet:play', anim)
      return { ok: true, action: 'animation', message: anim ? '播放：' + anim.assetId : '动画已关闭' }
    }
    if (cmd === '自定义言语') {
      this.openPanel('settings')
      return { ok: true, action: 'panel:settings' }
    }
    return { ok: false, message: '未知指令 /' + cmd }
  }

  getCommandHistory(): string[] { return this.db.getCommandHistory() }

  getSuggestions(input: string): string[] {
    const base = ['/任务', '/日记', '/计时', '/日历', '/复盘', '/动画', '/自定义言语', '/写日记 ', '/写入备忘录 ', '/打开 ', '/清空回收站']
    const aliases = Object.keys(BUILTIN_ALIASES).concat(this.db.listAppMaps().map(m => m.alias))
    const assetNames = this.manifest.map(a => a.assetId)
    const all = base.concat(aliases.map(a => '/打开 ' + a), assetNames.map(a => '/动画 ' + a))
    if (!input) return base
    return all.filter(s => s.toLowerCase().startsWith(input.toLowerCase())).slice(0, 12)
  }

  // ---------- scheduler ----------
  start(): void {
    if (this.schedulerTimer) return
    this.schedulerTimer = setInterval(() => this.tick(), 30000)
    this.tick()
  }
  stop(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer)
    this.schedulerTimer = null
  }

  private tick(): void {
    if (!this.isOnboardingDone()) return
    const d = new Date()
    const date = localDate(d)
    const time = hm(d)
    const hour = d.getHours()

    const resetKey = 'daily_reset:' + date
    if (this.lastSignals.get(resetKey) !== date) {
      // 每日任务在任务栏标记完成后即为“全局完成”，不再自动复活
      this.db.cleanupOldMemories()
      this.lastSignals.set(resetKey, date)
    }

    if (this.getSetting<boolean>('auto_plan', true)) {
      const todaySchedules = this.db.getSchedulesByDate(date)
      if (!todaySchedules.length) { void this.generatePlan().catch(() => {}) }
    }

    for (const s of this.db.getSchedulesByDate(date)) {
      if (s.status !== 'confirmed') continue
      const end = addMinutes(s.start_time, 10)
      if (time >= s.start_time && time < end) {
        const key = 'due:' + date + ':' + s.id
        if (this.lastSignals.get(key) !== date) {
          this.lastSignals.set(key, date)
          void this.notify('任务到点啦', '「' + (s.task_title || '任务') + '」到时间了，要开始吗？', 'task_start')
        }
      }
    }

    const careTimes = this.getSetting<{ time: string; event: string; title: string; body: string }[]>('care_times', [
      { time: '09:00', event: 'morning', title: '早安', body: '早上好呀~ 今天的计划准备好了吗？' },
      { time: '12:30', event: 'care_noon', title: '该吃饭啦', body: '先放下工作，好好吃顿饭吧！' },
      { time: '21:00', event: 'evening', title: '下班提醒', body: '今天辛苦啦，可以休息一下咯~' },
      { time: '23:00', event: 'night', title: '深夜提醒', body: '夜深了，别太熬夜哦，主人~' }
    ])
    for (const c of careTimes) {
      if (c.time === time) {
        const key = 'care:' + date + ':' + c.time
        if (this.lastSignals.get(key) !== date) {
          this.lastSignals.set(key, date)
          void this.notify(c.title, c.body, c.event)
        }
      }
    }

    const birthday = this.getSetting<string>('birthday', '')
    if (birthday && birthday.slice(5) === date.slice(5)) {
      const key = 'birthday:' + date
      if (this.lastSignals.get(key) !== date) {
        this.lastSignals.set(key, date)
        void this.notify('生日快乐！', '今天是主人生日，灵伴祝主人生日快乐！', 'birthday')
      }
    }

    if (hour >= 23 && d.getMinutes() >= 30) {
      const key = 'memory:' + date
      if (this.lastSignals.get(key) !== date) {
        this.lastSignals.set(key, date)
        void this.generateMemory()
      }
    }

    const running = this.db.getRunningFocus()
    if (running && now() - running.started_at > 2 * 3600 * 1000) {
      const key = 'health:' + date + ':' + running.id
      if (this.lastSignals.get(key) !== date) {
        this.lastSignals.set(key, date)
        void this.notify('连续工作提醒', '已经专注很久啦，起来活动一下，喝口水吧~', 'health_dizzy')
      }
    }
    if (running && hour >= 23) {
      const key = 'night:' + date + ':' + running.id
      if (this.lastSignals.get(key) !== date) {
        this.lastSignals.set(key, date)
        this.notifyEmotion('night_focus')
        void this.notify('夜深啦', '还在陪主人工作……心疼，忙完就早点休息吧', 'night')
      }
    }

    if (this.getSetting<boolean>('pet_playful_enabled', true) && !running && (hour >= 9 && hour <= 18)) {
      const key = 'idle:' + date + ':' + hour
      if (this.lastSignals.get(key) !== date) {
        this.lastSignals.set(key, date)
        const anim = this.trigger('idle')
        if (anim) this.send('pet:play', anim)
      }
    }
  }
}