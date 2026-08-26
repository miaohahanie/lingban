// 灵伴共享类型：主进程 / preload / 渲染进程共同使用
export type TaskTag = 'daily' | 'weekly' | 'once'
export type TaskStatus = 'active' | 'completed' | 'archived'
export type ScheduleStatus = 'planned' | 'confirmed' | 'done' | 'skipped' | 'missed'
export type FocusType = 'pomodoro' | 'countdown' | 'stopwatch'
export type FocusState = 'running' | 'paused' | 'finished' | 'cancelled'
export type Emotion = 'calm' | 'happy' | 'worried' | 'sympathetic' | 'admiring'
export type PanelName = 'tasks' | 'diary' | 'timer' | 'calendar' | 'settings'
export type AppMapType = 'url' | 'file' | 'app'

export interface Task {
  id: string
  title: string
  description: string | null
  tag: TaskTag
  weekly_times: number | null
  estimate_days: number | null
  estimate_minutes: number
  file_path: string | null
  status: TaskStatus
  progress: number
  current_day: number
  sort_order: number
  created_at: number
  updated_at: number
  completed_at: number | null
  archived_at: number | null
}

export interface ScheduleItem {
  id: string
  date: string // YYYY-MM-DD
  task_id: string
  start_time: string // HH:mm
  end_time: string
  status: ScheduleStatus
  manual: number
  created_at: number
  task_title?: string
  task_tag?: TaskTag
  estimate_minutes?: number
}

export interface FocusSession {
  id: string
  task_id: string | null
  type: FocusType
  state: FocusState
  started_at: number
  ended_at: number | null
  duration_sec: number
  note: string | null
}

export interface DiaryEntry {
  date: string
  task_summary: string | null
  focus_seconds: number
  reflection: string | null
  ai_review_score: number | null
  ai_review_comment: string | null
  created_at?: number
  updated_at?: number
}

export interface Memory {
  date: string
  summary: string
  created_at: number
}

export interface Memo {
  id: string
  content: string
  created_at: number
}

export interface Quote {
  id: string
  category: string
  text: string
  enabled: number
  created_at: number
}

export interface AppMap {
  id: string
  alias: string
  target: string
  type: AppMapType
  created_at: number
}

export interface PetAsset {
  assetId: string
  file: string
  caption: string
  category: string
  loop: boolean
  cooldownMin: number
  priority: number
  durationSec: number
}

export interface PetAnimationEvent {
  assetId: string
  caption: string | null
  loop: boolean
}

export interface ReviewResult {
  score: number
  comment: string
}

export interface NotificationPayload {
  title: string
  body: string
  animation?: string // assetId
}

export interface CommandResult {
  ok: boolean
  message?: string
  action?: string // panel:xxx | open:url | chat etc.
  payload?: unknown
}

export interface FocusStartInput {
  taskId?: string | null
  type: FocusType
  durationSec?: number
}

export interface OnboardingData {
  autostart: boolean
  autoPlan: boolean
  workDays: number[]
  workHours: { dayOfWeek: number; startHour: number; endHour: number }[]
  apiKey?: string
  tasks: { title: string; tag: TaskTag; estimateMinutes?: number; estimateDays?: number; weeklyTimes?: number }[]
  birthday?: string
}

export interface TimerState {
  active: FocusSession | null
  remainingSec: number
}

export interface FocusStats {
  totalSec: number
  sessions: number
}

export interface LingbanApi {
  app: {
    getVersion(): Promise<string>
    setAutoStart(v: boolean): Promise<void>
    getAutoStart(): Promise<boolean>
    reset(): Promise<void>
    quit(): void
  }
  settings: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    getAll(): Promise<Record<string, unknown>>
  }
  onboarding: {
    isDone(): Promise<boolean>
    complete(data: OnboardingData): Promise<void>
  }
  tasks: {
    list(): Promise<Task[]>
    create(input: Partial<Task>): Promise<Task>
    update(id: string, patch: Partial<Task>): Promise<Task>
    complete(id: string): Promise<Task>
    reopen(id: string): Promise<Task>
    archive(id: string): Promise<Task>
    remove(id: string): Promise<void>
    reorder(ids: string[]): Promise<void>
  }
  schedule: {
    getByDate(date: string): Promise<ScheduleItem[]>
    getRange(start: string, end: string): Promise<ScheduleItem[]>
    generateToday(): Promise<ScheduleItem[]>
    confirm(items: ScheduleItem[]): Promise<void>
    addManual(date: string, taskId: string, start: string, end: string): Promise<ScheduleItem[]>
    completeItem(id: string): Promise<void>
    updateItem(id: string, patch: Partial<ScheduleItem>): Promise<void>
    removeItem(id: string): Promise<void>
    rePlanWeek(): Promise<void>
  }
  timer: {
    start(input: FocusStartInput): Promise<FocusSession>
    stop(id: string): Promise<FocusSession>
    cancel(id: string): Promise<FocusSession>
    getActive(): Promise<TimerState>
  }
  diary: {
    getByDate(date: string): Promise<DiaryEntry | null>
    saveReflection(date: string, text: string): Promise<void>
    getRange(start: string, end: string): Promise<DiaryEntry[]>
  }
  focus: {
    listToday(): Promise<FocusSession[]>
    stats(): Promise<FocusStats>
  }
  ai: {
    generatePlan(): Promise<ScheduleItem[]>
    generateMemory(): Promise<Memory | null>
    review(date: string): Promise<ReviewResult | null>
    chat(text: string): Promise<string | null>
    testKey(key: string): Promise<boolean>
    setKey(key: string): Promise<void>
    clearKey(): Promise<void>
  }
  memo: { list(): Promise<Memo[]>; add(content: string): Promise<Memo>; remove(id: string): Promise<void> }
  commands: {
    execute(input: string): Promise<CommandResult>
    getHistory(): Promise<string[]>
    getSuggestions(input: string): Promise<string[]>
  }
  animation: {
    getManifest(): Promise<PetAsset[]>
    getAsset(file: string): Promise<string>
    trigger(event: string, context?: Record<string, unknown>): Promise<PetAnimationEvent | null>
    preview(name?: string): Promise<PetAnimationEvent | null>
    setEnabled(v: boolean): Promise<void>
    getEnabled(): Promise<boolean>
  }
  emotions: { get(): Promise<Emotion>; notify(event: string): Promise<void> }
  minimal: { get(): Promise<boolean>; set(v: boolean): Promise<void> }
  window: {
    setPanelOpen(open: boolean): Promise<void>
    setInteractive(interactive: boolean): Promise<void>
    getPosition(): Promise<{ x: number; y: number }>
    moveBy(dx: number, dy: number): Promise<void>
    resetPosition(): Promise<void>
  }
  open: { openPath(p: string): Promise<boolean>; openUrl(u: string): Promise<boolean>; openApp(p: string): Promise<boolean> }
  quotes: { list(): Promise<Quote[]>; add(q: Partial<Quote>): Promise<Quote>; update(id: string, patch: Partial<Quote>): Promise<Quote>; remove(id: string): Promise<void>; toggle(id: string): Promise<void> }
  notify(title: string, body: string): void
  on(channel: string, cb: (payload: unknown) => void): () => void
}