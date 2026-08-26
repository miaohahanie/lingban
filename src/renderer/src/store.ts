import { defineStore } from 'pinia'
import type {
  Task, ScheduleItem, DiaryEntry, Memo, Quote, PetAsset, PetAnimationEvent, Emotion,
  PanelName, TimerState, FocusStats, CommandResult
} from '../../shared/types'

function today(): string {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export const useLingbanStore = defineStore('lingban', {
  state: () => ({
    version: '',
    onboardingDone: false,
    manifest: [] as PetAsset[],
    assetCache: {} as Record<string, string>,
    currentAnimation: null as PetAnimationEvent | null,
    currentCaption: null as string | null,
    captionKey: 0,
    captionTimer: null as ReturnType<typeof setTimeout> | null,
    emotion: 'calm' as Emotion,
    tasks: [] as Task[],
    schedules: [] as ScheduleItem[],
    diary: null as DiaryEntry | null,
    diaryDate: today(),
    memos: [] as Memo[],
    quotes: [] as Quote[],
    chatterTimer: null as ReturnType<typeof setInterval> | null,
    chatterPool: [] as Quote[],
    lastSpokenText: null as string | null,
    settings: {} as Record<string, unknown>,
    minimalMode: false,
    panel: null as PanelName | null,
    commandOpen: false,
    commandText: '',
    suggestions: [] as string[],
    history: [] as string[],
    timer: { active: null, remainingSec: 0 } as TimerState,
    focusStats: { totalSec: 0, sessions: 0 } as FocusStats,
    toast: null as { title: string; body: string } | null,
    chatReply: null as string | null,
    reviewResult: null as { score: number; comment: string } | null,
    loading: false,
    timerFns: [] as (() => void)[],
    animTimer: null as ReturnType<typeof setTimeout> | null,
    animPool: [] as string[],
    animIndex: -1,
    stateLoopKind: null as 'focus' | 'break' | null,
    tickTimer: null as ReturnType<typeof setInterval> | null
  }),

  getters: {
    activeTasks(state): Task[] { return state.tasks.filter(t => t.status === 'active') },
    doneTasks(state): Task[] { return state.tasks.filter(t => t.status === 'completed') },
    todayDoneCount(state): number { return state.schedules.filter(s => s.status === 'done').length },
    focusMinutes(state): number { return Math.round(state.focusStats.totalSec / 60) },
    timerDurationSec(state): number {
      const a = state.timer.active
      if (!a?.note) return 0
      try { return Number((JSON.parse(a.note) as { durationSec?: number }).durationSec) || 0 } catch { return 0 }
    },
    timerProgress(state): number {
      const a = state.timer.active
      if (!a) return 0
      const total = this.timerDurationSec
      if (total > 0) return Math.min(1, Math.max(0, (total - state.timer.remainingSec) / total))
      return state.timer.remainingSec > 0 ? 0 : 0
    },
    timerText(state): string {
      const a = state.timer.active
      if (!a) return '00:00'
      const sec = a.type === 'stopwatch' ? Math.floor((Date.now() - a.started_at) / 1000) : state.timer.remainingSec
      const m = Math.floor(sec / 60)
      const s = sec % 60
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    }
  },

  actions: {
    addTimerFn(fn: () => void): void { this.timerFns.push(fn) },
    cleanupTimers(): void { this.timerFns.forEach(fn => fn()); this.timerFns = []; this.clearAnimTimer(); this.stopChatter(); this.stopTimerTick() },

    async init(): Promise<void> {
      const api = window.lingban
      this.version = await api.app.getVersion()
      this.onboardingDone = await api.onboarding.isDone()
      await this.loadAll()
      // 事件订阅
      api.on('pet:play', (p) => { if (p) void this.setAnimation(p as PetAnimationEvent) })
      api.on('pet:notify', (p) => {
        const n = p as { title: string; body: string; animation?: PetAnimationEvent | null }
        this.toast = { title: n.title, body: n.body }
        if (n.animation) void this.setAnimation(n.animation)
        setTimeout(() => { this.toast = null }, 6000)
      })
      api.on('pet:openPanel', (p) => this.openPanel(p as PanelName))
      api.on('pet:chatReply', (p) => {
        const text = String(p || '')
        this.chatReply = text
        // 回复框 10s 后自动消失，避免长期驻留顶部遮挡气泡
        if (text) setTimeout(() => { if (this.chatReply === text) this.chatReply = null }, 10000)
      })
      api.on('pet:review', (p) => { this.reviewResult = p as { score: number; comment: string } })
      api.on('pet:emotion', (p) => { this.emotion = p as Emotion })
      api.on('pet:minimal', (p) => { this.minimalMode = !!p; if (this.minimalMode) { this.panel = null; this.commandOpen = false } })
      if (this.onboardingDone) this.startChatter()
    },

    startChatter(): void {
      if (this.chatterTimer) return
      this.chatterPool = []
      // 每秒 tick 一次，以低概率（约 1%，平均 ~100 秒一句）随机吐一句话
      this.chatterTimer = setInterval(() => {
        // 面板/指令打开或气泡正在显示时跳过，避免遮挡与台词互相打断
        if (this.panel || this.commandOpen || this.currentCaption) return
        const pool = this.quotes.filter(q => q.enabled === 1)
        if (!pool.length) return
        if (Math.random() > 0.01) return
        // 洗牌池轮播，避免连续重复同一句
        if (!this.chatterPool.length) {
          this.chatterPool = [...pool].sort(() => Math.random() - 0.5)
        }
        let q = this.chatterPool.pop()
        if (q && q.text === this.lastSpokenText && this.chatterPool.length) {
          const swap = this.chatterPool.pop()
          if (swap) { this.chatterPool.unshift(q); q = swap }
        }
        if (q) { this.lastSpokenText = q.text; this.showCaption(q.text) }
      }, 1000)
    },

    stopChatter(): void {
      if (this.chatterTimer) { clearInterval(this.chatterTimer); this.chatterTimer = null }
    },

    async loadAll(): Promise<void> {
      const api = window.lingban
      const [manifest, tasks, schedules, diary, memos, quotes, settings, emotion, timer, focusStats, history] = await Promise.all([
        api.animation.getManifest(),
        api.tasks.list(),
        api.schedule.getByDate(today()),
        api.diary.getByDate(this.diaryDate),
        api.memo.list(),
        api.quotes.list(),
        api.settings.getAll(),
        api.emotions.get(),
        api.timer.getActive(),
        api.focus.stats(),
        api.commands.getHistory()
      ])
      this.manifest = manifest
      this.tasks = tasks
      this.schedules = schedules
      this.diary = diary
      this.memos = memos
      this.quotes = quotes
      this.settings = settings
      this.emotion = emotion
      this.timer = timer
      this.focusStats = focusStats
      this.history = history
      this.minimalMode = Boolean(settings['pet_minimal_mode'])
      if (this.timer.active) this.startTimerTick()
      if (!this.currentAnimation) await this.dispatch('app_start')
    },

    startTimerTick(): void {
      if (this.tickTimer) return
      this.tickTimer = setInterval(async () => {
        if (!this.timer.active) { this.stopTimerTick(); return }
        if (this.timer.active.type !== 'stopwatch') {
          this.timer.remainingSec = Math.max(0, this.timer.remainingSec - 1)
          if (this.timer.remainingSec <= 0) {
            this.stopTimerTick()
            this.stopStateLoop(false)
            const id = this.timer.active.id
            await window.lingban.timer.stop(id)
            this.timer = await window.lingban.timer.getActive()
            await this.refreshStats()
          }
        } else {
          this.timer.remainingSec = Math.floor((Date.now() - this.timer.active.started_at) / 1000)
        }
        if (Math.floor(Date.now() / 5000) % 5 === 0) void this.refreshStats()
      }, 1000)
    },

    stopTimerTick(): void {
      if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }
    },

    async dispatch(event: string): Promise<PetAnimationEvent | null> {
      const anim = await window.lingban.animation.trigger(event)
      if (anim) await this.setAnimation(anim)
      return anim
    },

    /** 点击互动：切换动画 + 从语料库随机说一句话（气泡 3.5s 后消失）。
     *  动画与说话解耦：动画被禁用/触发失败时也保证有语音反馈。 */
    async clickInteract(): Promise<void> {
      const pool = this.quotes.filter(q => q.enabled === 1 && q.category !== 'birthday')
      const source = pool.length ? pool : [{ id: 'fallback', category: 'random', text: '我在呢~', enabled: 1, created_at: 0 } as Quote]
      let q = source[Math.floor(Math.random() * source.length)]
      // 避免与上一句重复，最多重试 4 次
      for (let i = 0; i < 4 && q.text === this.lastSpokenText && source.length > 1; i++) {
        q = source[Math.floor(Math.random() * source.length)]
      }
      try { await this.dispatch('click') } catch { /* 动画失败不影响说话 */ }
      this.lastSpokenText = q.text
      this.showCaption(q.text)
    },

    async setAnimation(anim: PetAnimationEvent | null): Promise<void> {
      if (!anim) { this.clearAnimTimer(); this.currentAnimation = null; return }
      const asset = this.manifest.find(a => a.assetId === anim.assetId)
      if (!asset) return
      if (!this.assetCache[asset.file]) {
        this.assetCache[asset.file] = await window.lingban.animation.getAsset(asset.file)
      }
      const resumeKind = this.stateLoopKind
      if (resumeKind) this.stopStateLoop(false)
      this.currentAnimation = { ...anim, loop: false }
      this.showCaption(asset.caption)
      this.schedulePlay(asset.durationSec || 6, () => {
        if (resumeKind && this.timer.active) void this.startStateLoop(resumeKind)
        // 保留素材库 GIF 最后一帧展示，避免切换到非素材的 SVG 占位
      })
    },

    showCaption(text: string | null): void {
      this.currentCaption = text
      this.captionKey++
      if (this.captionTimer) clearTimeout(this.captionTimer)
      if (text) this.captionTimer = setTimeout(() => { this.currentCaption = null }, 3500)
    },

    clearAnimTimer(): void {
      if (this.animTimer) { clearTimeout(this.animTimer); this.animTimer = null }
    },

    schedulePlay(sec: number, fn: () => void): void {
      this.clearAnimTimer()
      this.animTimer = setTimeout(() => { this.animTimer = null; fn() }, Math.max(1000, sec) * 1000)
    },

    async playAssetById(assetId: string): Promise<void> {
      const asset = this.manifest.find(a => a.assetId === assetId)
      if (!asset) return
      if (!this.assetCache[asset.file]) {
        this.assetCache[asset.file] = await window.lingban.animation.getAsset(asset.file)
      }
      this.currentAnimation = { assetId, caption: asset.caption, loop: false }
      this.showCaption(asset.caption)
      this.schedulePlay(asset.durationSec || 6, () => { void this.playNextFromPool() })
    },

    async playNextFromPool(): Promise<void> {
      if (!this.stateLoopKind || !this.animPool.length) return
      this.animIndex = (this.animIndex + 1) % this.animPool.length
      await this.playAssetById(this.animPool[this.animIndex])
    },

    async startStateLoop(kind: 'focus' | 'break'): Promise<void> {
      this.stateLoopKind = kind
      this.animPool = kind === 'focus'
        ? ['focus_working', 'planning_thinking', 'focus_working', 'cheer_go']
        : ['break_resting', 'playful_phone', 'break_resting', 'affection_love']
      this.animIndex = -1
      await this.playNextFromPool()
    },

    stopStateLoop(clearCurrent = false): void {
      this.stateLoopKind = null
      this.animPool = []
      this.animIndex = -1
      this.clearAnimTimer()
      if (clearCurrent) this.currentAnimation = null
    },

    /** 极简模式：只保留桌宠本体与点击互动。开启时收起面板与指令框 */
    async setMinimalMode(v: boolean): Promise<void> {
      this.minimalMode = v
      await window.lingban.minimal.set(v)
      if (v) {
        if (this.panel) await this.closePanel()
        this.toggleCommand(false)
      }
    },

    async openPanel(name: PanelName): Promise<void> {
      if (this.minimalMode) return
      this.panel = name
      await window.lingban.window.setInteractive(true)
      await window.lingban.window.setPanelOpen(true)
      if (name === 'diary') await this.refreshDiary()
    },

    async closePanel(): Promise<void> {
      this.panel = null
      await window.lingban.window.setPanelOpen(false)
    },

    toggleCommand(open?: boolean): void {
      if (this.minimalMode) return
      this.commandOpen = open === undefined ? !this.commandOpen : open
      if (this.commandOpen) void window.lingban.window.setInteractive(true)
    },

    async refreshTasks(): Promise<void> { this.tasks = await window.lingban.tasks.list() },
    async refreshDiary(): Promise<void> { this.diary = await window.lingban.diary.getByDate(this.diaryDate) },
    async refreshSchedules(): Promise<void> { this.schedules = await window.lingban.schedule.getByDate(today()) },
    async loadWeek(start: string, end: string): Promise<void> { this.schedules = await window.lingban.schedule.getRange(start, end) },
    async refreshStats(): Promise<void> { this.focusStats = await window.lingban.focus.stats() },

    async addTask(input: Partial<Task>): Promise<void> {
      await window.lingban.tasks.create(input)
      await this.refreshTasks()
    },

    async completeTask(id: string): Promise<void> {
      await window.lingban.tasks.complete(id)
      await this.refreshTasks()
      await this.refreshStats()
    },

    async runReview(): Promise<void> {
      this.reviewResult = await window.lingban.ai.review(this.diaryDate)
      await this.refreshDiary()
    },

    async executeCommand(text: string): Promise<CommandResult> {
      const res = await window.lingban.commands.execute(text)
      this.history = await window.lingban.commands.getHistory()
      return res
    },

    async updateSuggestions(input: string): Promise<void> {
      this.suggestions = await window.lingban.commands.getSuggestions(input)
    }
  }
})