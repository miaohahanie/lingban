import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { Task, ScheduleItem, FocusSession, DiaryEntry, Memory, Memo, Quote, AppMap } from '../shared/types'

interface HistoryRow { id: string; command: string; created_at: number }

interface DBShape {
  settings: Record<string, unknown>
  workDays: number[]
  workHours: { dayOfWeek: number; startHour: number; endHour: number }[]
  tasks: Task[]
  schedules: ScheduleItem[]
  focusSessions: FocusSession[]
  diaryEntries: Record<string, DiaryEntry>
  memories: Record<string, Memory>
  memos: Memo[]
  quotes: Quote[]
  commandHistory: HistoryRow[]
  appMaps: AppMap[]
}

function now(): number { return Date.now() }
function t(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}
function localDate(d: Date = new Date()): string { return t(d) }

function emptyShape(): DBShape {
  return {
    settings: {},
    workDays: [1, 2, 3, 4, 5],
    workHours: [{ dayOfWeek: -1, startHour: 9, endHour: 18 }],
    tasks: [],
    schedules: [],
    focusSessions: [],
    diaryEntries: {},
    memories: {},
    memos: [],
    quotes: [],
    commandHistory: [],
    appMaps: []
  }
}

export class DB {
  private data: DBShape
  private file: string

  constructor() {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(dir, 'secure'), { recursive: true })
    this.file = path.join(dir, 'lingban-data.json')
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      this.data = { ...emptyShape(), ...(JSON.parse(raw) as Partial<DBShape>) }
    } catch {
      this.data = emptyShape()
    }
    this.dedupeTasks()
    this.seedQuotes()
    this.save()
  }

  private dedupeTasks(): void {
    if (this.getSetting<boolean>('task_dedupe_v1', false)) return
    const byTitle = new Map<string, Task[]>()
    for (const t of this.data.tasks) {
      const key = t.title.trim().toLowerCase()
      if (!byTitle.has(key)) byTitle.set(key, [])
      byTitle.get(key)!.push(t)
    }
    const toRemove = new Set<string>()
    for (const arr of byTitle.values()) {
      if (arr.length <= 1) continue
      const keeper = arr.find(t => t.status === 'active') || arr[0]
      for (const t of arr) if (t.id !== keeper.id) toRemove.add(t.id)
    }
    if (toRemove.size) {
      this.data.tasks = this.data.tasks.filter(t => !toRemove.has(t.id))
      this.data.schedules = this.data.schedules.filter(s => !toRemove.has(s.task_id))
      this.data.focusSessions = this.data.focusSessions.map(f => f.task_id && toRemove.has(f.task_id) ? { ...f, task_id: null } : f)
    }
    this.setSetting('task_dedupe_v1', true)
  }

  private seedQuotes(): void {
    if (this.data.quotes.length) return
    const defaults: { category: string; text: string }[] = [
      { category: 'greeting', text: '早上好呀，主人~ 今天也要元气满满！' },
      { category: 'greeting', text: '突然出现！我一直都在哦~' },
      { category: 'care', text: '该吃饭啦，先好好吃饭再工作吧！' },
      { category: 'care', text: '喝口水休息一下，别太累啦~' },
      { category: 'focus_start', text: '开始专注工作啦，加油！' },
      { category: 'focus_end', text: '顺利完成~ 主人辛苦啦！' },
      { category: 'break', text: '休息一下，摸摸头~' },
      { category: 'break', text: '小憩几分钟，回来继续~' },
      { category: 'cheer', text: '主人加油呀！你可以的！' },
      { category: 'praise', text: '主人好厉害！完成得真棒！' },
      { category: 'praise', text: '今天也稳稳地完成了任务~' },
      { category: 'relax', text: '别太紧张啦，慢慢来，有我陪着你~' },
      { category: 'health', text: '已经工作很久啦，起来活动一下吧~' },
      { category: 'health', text: '心疼主人，忙完要早点休息哦~' },
      { category: 'overload', text: '工作越多越应该绅士，先喝杯茶~' },
      { category: 'playful', text: '主人不理我…我玩会儿手机~' },
      { category: 'playful', text: '抛媚眼~主人看我吗？' },
      { category: 'playful', text: '鬼点子发动中！嘿嘿~' },
      { category: 'affection', text: '最喜欢主人了~' },
      { category: 'birthday', text: '生日快乐！祝主人愿望成真！' },
      { category: 'random', text: '我在呢，随时叫我哦~' },
      { category: 'random', text: '今天也要好好照顾自己~' },
      { category: 'random', text: '主人今天心情怎么样呀？' },
      { category: 'random', text: '灵伴会一直陪着你~' }
    ]
    const t = now()
    for (const q of defaults) {
      this.data.quotes.push({ id: randomUUID(), category: q.category, text: q.text, enabled: 1, created_at: t })
    }
  }

  private save(): void {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)) } catch { /* ignore */ }
  }

  // ---------- settings ----------
  getSetting<T = unknown>(key: string, def: T): T {
    if (Object.prototype.hasOwnProperty.call(this.data.settings, key)) {
      const v = this.data.settings[key]
      if (v === null || v === undefined) return def
      return v as T
    }
    return def
  }
  setSetting(key: string, value: unknown): void {
    this.data.settings[key] = value
    this.save()
  }
  getAllSettings(): Record<string, unknown> { return { ...this.data.settings } }

  getWorkDays(): number[] { return [...this.data.workDays] }
  setWorkDays(days: number[]): void { this.data.workDays = [...days]; this.save() }

  getWorkHours(): { dayOfWeek: number; startHour: number; endHour: number }[] { return this.data.workHours.map(x => ({ ...x })) }
  setWorkHours(list: { dayOfWeek: number; startHour: number; endHour: number }[]): void { this.data.workHours = list.map(x => ({ ...x })); this.save() }

  // ---------- tasks ----------
  listTasks(includeArchived = false): Task[] {
    return this.data.tasks.filter(x => includeArchived || x.status !== 'archived').sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at)
  }
  getTask(id: string): Task | null { return this.data.tasks.find(x => x.id === id) || null }
  createTask(input: Partial<Task>): Task {
    const id = randomUUID(); const t = now()
    const task: Task = {
      id,
      title: input.title || '未命名任务',
      description: input.description ?? null,
      tag: input.tag ?? 'daily',
      weekly_times: input.weekly_times ?? null,
      estimate_days: input.estimate_days ?? null,
      estimate_minutes: input.estimate_minutes ?? 25,
      file_path: input.file_path ?? null,
      status: 'active',
      progress: 0,
      current_day: 0,
      sort_order: input.sort_order ?? this.data.tasks.length + 1,
      created_at: t,
      updated_at: t,
      completed_at: null,
      archived_at: null
    }
    this.data.tasks.push(task); this.save()
    return { ...task }
  }
  updateTask(id: string, patch: Partial<Task>): Task {
    const idx = this.data.tasks.findIndex(x => x.id === id)
    if (idx < 0) throw new Error('task not found')
    this.data.tasks[idx] = { ...this.data.tasks[idx], ...patch, id, updated_at: now() }
    this.save()
    return { ...this.data.tasks[idx] }
  }
  completeTask(id: string): Task { return this.updateTask(id, { status: 'completed', completed_at: now(), progress: 100 }) }
  reopenTask(id: string): Task { return this.updateTask(id, { status: 'active', completed_at: null, progress: 0, current_day: 0 }) }
  archiveTask(id: string): Task { return this.updateTask(id, { status: 'archived', archived_at: now() }) }
  deleteTask(id: string): void {
    this.data.tasks = this.data.tasks.filter(x => x.id !== id)
    this.data.schedules = this.data.schedules.filter(x => x.task_id !== id)
    this.save()
  }
  reorderTasks(ids: string[]): void {
    const t = now()
    ids.forEach((id, i) => {
      const idx = this.data.tasks.findIndex(x => x.id === id)
      if (idx >= 0) this.data.tasks[idx] = { ...this.data.tasks[idx], sort_order: i + 1, updated_at: t }
    })
    this.save()
  }

  // ---------- schedules ----------
  private withTaskMeta(s: ScheduleItem): ScheduleItem {
    const task = this.getTask(s.task_id)
    return { ...s, task_title: task?.title, task_tag: task?.tag, estimate_minutes: task?.estimate_minutes }
  }
  getSchedulesByDate(date: string): ScheduleItem[] {
    return this.data.schedules.filter(x => x.date === date).sort((a, b) => a.start_time.localeCompare(b.start_time)).map(s => this.withTaskMeta(s))
  }
  getSchedulesBetween(start: string, end: string): ScheduleItem[] {
    return this.data.schedules.filter(x => x.date >= start && x.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)).map(s => this.withTaskMeta(s))
  }
  upsertSchedules(items: Omit<ScheduleItem, 'created_at' | 'task_title' | 'task_tag' | 'estimate_minutes'>[]): ScheduleItem[] {
    const t = now()
    for (const it of items) {
      const idx = this.data.schedules.findIndex(x => x.id === it.id)
      const row: ScheduleItem = { ...it, task_title: undefined, task_tag: undefined, estimate_minutes: undefined, created_at: t }
      if (idx >= 0) this.data.schedules[idx] = row
      else this.data.schedules.push(row)
    }
    this.save()
    const date = items[0]?.date || localDate()
    return this.getSchedulesByDate(date)
  }
  updateSchedule(id: string, patch: Partial<ScheduleItem>): void {
    const idx = this.data.schedules.findIndex(x => x.id === id)
    if (idx < 0) return
    this.data.schedules[idx] = { ...this.data.schedules[idx], ...patch, id }
    this.save()
  }
  deleteSchedule(id: string): void {
    this.data.schedules = this.data.schedules.filter(x => x.id !== id)
    this.save()
  }
  deleteSchedulesByDate(date: string): void {
    const confirmed = new Set(this.data.schedules.filter(x => x.date === date && (x.status === 'confirmed' || x.status === 'done')).map(x => x.id))
    this.data.schedules = this.data.schedules.filter(x => !(x.date === date && !confirmed.has(x.id)))
    this.save()
  }

  // ---------- focus ----------
  startFocus(input: { taskId?: string | null; type: FocusSession['type']; durationSec?: number }): FocusSession {
    const s: FocusSession = {
      id: randomUUID(),
      task_id: input.taskId ?? null,
      type: input.type,
      state: 'running',
      started_at: now(),
      ended_at: null,
      duration_sec: 0,
      note: null
    }
    this.data.focusSessions.push(s); this.save()
    return { ...s }
  }
  setFocusNote(id: string, note: string | null): void {
    const idx = this.data.focusSessions.findIndex(x => x.id === id)
    if (idx >= 0) { this.data.focusSessions[idx] = { ...this.data.focusSessions[idx], note }; this.save() }
  }
  getFocusSession(id: string): FocusSession | null {
    const s = this.data.focusSessions.find(x => x.id === id)
    return s ? { ...s } : null
  }
  stopFocus(id: string, durationSec: number, cancelled = false): FocusSession {
    const idx = this.data.focusSessions.findIndex(x => x.id === id)
    if (idx < 0) throw new Error('focus not found')
    this.data.focusSessions[idx] = { ...this.data.focusSessions[idx], state: cancelled ? 'cancelled' : 'finished', ended_at: now(), duration_sec: durationSec }
    const s = this.data.focusSessions[idx]
    if (s.task_id) this.accumulateFocusToTask(s.task_id, s.duration_sec, s.started_at)
    this.save()
    return { ...s }
  }
  private accumulateFocusToTask(taskId: string, sec: number, startedAt: number): void {
    const task = this.getTask(taskId)
    if (!task || task.tag !== 'once' || task.status !== 'active') return
    const day = t(new Date(startedAt))
    const daySec = this.data.focusSessions
      .filter(x => x.task_id === taskId && x.state === 'finished' && t(new Date(x.started_at)) === day)
      .reduce((sum, x) => sum + x.duration_sec, 0)
    if (daySec >= 600) {
      const days = task.estimate_days || 1
      const nextDay = Math.min(days, task.current_day + 1)
      this.updateTask(taskId, { current_day: nextDay, progress: Math.min(100, Math.round((nextDay / days) * 100)) })
    }
  }
  getRunningFocus(): FocusSession | null {
    const s = this.data.focusSessions.filter(x => x.state === 'running').sort((a, b) => b.started_at - a.started_at)[0]
    return s ? { ...s } : null
  }
  listFocusToday(): FocusSession[] {
    const day = localDate()
    return this.data.focusSessions.filter(x => t(new Date(x.started_at)) === day).sort((a, b) => b.started_at - a.started_at).map(x => ({ ...x }))
  }
  focusStatsToday(): { totalSec: number; sessions: number } {
    const day = localDate()
    const list = this.data.focusSessions.filter(x => t(new Date(x.started_at)) === day && x.state === 'finished')
    return { totalSec: list.reduce((a, x) => a + x.duration_sec, 0), sessions: list.length }
  }

  // ---------- diary ----------
  getDiary(date: string): DiaryEntry | null {
    const d = this.data.diaryEntries[date]
    return d ? { ...d } : null
  }
  ensureDiary(date: string): DiaryEntry {
    if (!this.data.diaryEntries[date]) {
      const t = now()
      this.data.diaryEntries[date] = { date, task_summary: null, focus_seconds: 0, reflection: null, ai_review_score: null, ai_review_comment: null, created_at: t, updated_at: t }
      this.save()
    }
    return { ...this.data.diaryEntries[date] }
  }
  saveReflection(date: string, text: string): DiaryEntry {
    this.ensureDiary(date)
    this.data.diaryEntries[date] = { ...this.data.diaryEntries[date], reflection: text, updated_at: now() }
    this.save()
    return { ...this.data.diaryEntries[date] }
  }
  addDiaryCompletion(date: string, title: string): void {
    this.ensureDiary(date)
    const d = this.data.diaryEntries[date]
    const summary = d.task_summary ? d.task_summary + '；' + title : title
    this.data.diaryEntries[date] = { ...d, task_summary: summary, updated_at: now() }
    this.save()
  }
  updateDiaryFocus(date: string, focusSec: number): void {
    this.ensureDiary(date)
    this.data.diaryEntries[date] = { ...this.data.diaryEntries[date], focus_seconds: focusSec, updated_at: now() }
    this.save()
  }
  saveReview(date: string, score: number, comment: string): void {
    this.ensureDiary(date)
    this.data.diaryEntries[date] = { ...this.data.diaryEntries[date], ai_review_score: score, ai_review_comment: comment, updated_at: now() }
    this.save()
  }
  getDiaryRange(start: string, end: string): DiaryEntry[] {
    return Object.values(this.data.diaryEntries).filter(x => x.date >= start && x.date <= end).sort((a, b) => b.date.localeCompare(a.date)).map(x => ({ ...x }))
  }

  // ---------- memories ----------
  upsertMemory(date: string, summary: string): Memory {
    this.data.memories[date] = { date, summary, created_at: now() }
    this.save()
    return { ...this.data.memories[date] }
  }
  listMemories(): Memory[] {
    return Object.values(this.data.memories).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7).map(x => ({ ...x }))
  }
  cleanupOldMemories(): void {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7)
    const cs = localDate(cutoff)
    for (const k of Object.keys(this.data.memories)) if (k < cs) delete this.data.memories[k]
    this.save()
  }

  // ---------- memos / quotes / history / maps ----------
  listMemos(): Memo[] { return this.data.memos.map(x => ({ ...x })) }
  addMemo(content: string): Memo {
    const m: Memo = { id: randomUUID(), content, created_at: now() }
    this.data.memos.unshift(m); this.save()
    return { ...m }
  }
  removeMemo(id: string): void { this.data.memos = this.data.memos.filter(x => x.id !== id); this.save() }
  listQuotes(): Quote[] { return this.data.quotes.map(x => ({ ...x })) }
  addQuote(q: Partial<Quote>): Quote {
    const item: Quote = { id: randomUUID(), category: q.category || 'random', text: q.text || '', enabled: q.enabled ?? 1, created_at: now() }
    this.data.quotes.push(item); this.save()
    return { ...item }
  }
  updateQuote(id: string, patch: Partial<Quote>): void {
    const idx = this.data.quotes.findIndex(x => x.id === id)
    if (idx >= 0) { this.data.quotes[idx] = { ...this.data.quotes[idx], ...patch, id }; this.save() }
  }
  deleteQuote(id: string): void { this.data.quotes = this.data.quotes.filter(x => x.id !== id); this.save() }
  listAppMaps(): AppMap[] { return this.data.appMaps.map(x => ({ ...x })) }
  addAppMap(alias: string, target: string, type: AppMap['type']): AppMap {
    const item: AppMap = { id: randomUUID(), alias, target, type, created_at: now() }
    this.data.appMaps.push(item); this.save()
    return { ...item }
  }
  deleteAppMap(id: string): void { this.data.appMaps = this.data.appMaps.filter(x => x.id !== id); this.save() }
  addCommandHistory(command: string): void {
    this.data.commandHistory.unshift({ id: randomUUID(), command, created_at: now() })
    this.data.commandHistory = this.data.commandHistory.slice(0, 50)
    this.save()
  }
  getCommandHistory(): string[] { return this.data.commandHistory.map(x => x.command) }
}