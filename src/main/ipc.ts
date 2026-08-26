import { app, ipcMain } from 'electron'
import type { Services } from './services'
import type { PanelName } from '../shared/types'

export interface WindowCtl {
  setPanelOpen(open: boolean): void
  setInteractive(interactive: boolean): void
  getPosition(): { x: number; y: number }
  moveBy(dx: number, dy: number): void
  resetPosition(): void
}

export function registerIpc(svc: Services, win: WindowCtl): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:setAutoStart', (_e, v: boolean) => {
    app.setLoginItemSettings({ openAtLogin: !!v })
    svc.setSetting('autostart', !!v)
  })
  ipcMain.handle('app:getAutoStart', () => svc.getSetting<boolean>('autostart', true))
  ipcMain.handle('app:reset', () => svc.reset())
  ipcMain.on('app:quit', () => app.quit())

  ipcMain.handle('settings:get', (_e, key: string) => svc.getSetting(key, null))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => svc.setSetting(key, value))
  ipcMain.handle('settings:getAll', () => svc.getAllSettings())

  ipcMain.handle('onboarding:isDone', () => svc.isOnboardingDone())
  ipcMain.handle('onboarding:complete', async (_e, data) => {
    console.log('[main] onboarding:complete called')
    try {
      await svc.completeOnboarding(data)
      console.log('[main] onboarding:complete OK')
    } catch (e) {
      console.error('[main] onboarding:complete FAILED', e)
      throw e
    }
  })

  ipcMain.handle('tasks:list', () => svc.listTasks())
  ipcMain.handle('tasks:create', (_e, input) => svc.createTask(input))
  ipcMain.handle('tasks:update', (_e, id: string, patch) => svc.updateTask(id, patch))
  ipcMain.handle('tasks:complete', (_e, id: string) => svc.completeTask(id))
  ipcMain.handle('tasks:reopen', (_e, id: string) => svc.reopenTask(id))
  ipcMain.handle('tasks:archive', (_e, id: string) => svc.archiveTask(id))
  ipcMain.handle('tasks:remove', (_e, id: string) => svc.deleteTask(id))
  ipcMain.handle('tasks:reorder', (_e, ids: string[]) => svc.reorderTasks(ids))

  ipcMain.handle('schedule:getByDate', (_e, date: string) => svc.getSchedulesByDate(date))
  ipcMain.handle('schedule:getRange', (_e, start: string, end: string) => svc.getSchedulesRange(start, end))
  ipcMain.handle('schedule:addManual', (_e, date: string, taskId: string, start: string, end: string) => svc.addManualSchedule(date, taskId, start, end))
  ipcMain.handle('schedule:completeItem', (_e, id: string) => svc.completeSchedule(id))
  ipcMain.handle('schedule:generateToday', () => svc.generatePlan())
  ipcMain.handle('schedule:confirm', (_e, items) => svc.confirmSchedules(items))
  ipcMain.handle('schedule:updateItem', (_e, id: string, patch) => svc.updateSchedule(id, patch))
  ipcMain.handle('schedule:removeItem', (_e, id: string) => svc.removeSchedule(id))
  ipcMain.handle('schedule:rePlanWeek', () => svc.rePlanWeek())

  ipcMain.handle('timer:start', (_e, input) => svc.startFocus(input))
  ipcMain.handle('timer:stop', (_e, id: string) => svc.stopFocus(id))
  ipcMain.handle('timer:cancel', (_e, id: string) => svc.cancelFocus(id))
  ipcMain.handle('timer:getActive', () => svc.getActiveTimer())

  ipcMain.handle('diary:getByDate', (_e, date: string) => svc.getDiary(date))
  ipcMain.handle('diary:saveReflection', (_e, date: string, text: string) => svc.saveReflection(date, text))
  ipcMain.handle('diary:getRange', (_e, start: string, end: string) => svc.getDiaryRange(start, end))

  ipcMain.handle('focus:listToday', () => svc.listFocusToday())
  ipcMain.handle('focus:stats', () => svc.focusStats())

  ipcMain.handle('ai:generatePlan', () => svc.generatePlan())
  ipcMain.handle('ai:generateMemory', () => svc.generateMemory())
  ipcMain.handle('ai:review', (_e, date: string) => svc.review(date))
  ipcMain.handle('ai:chat', (_e, text: string) => svc.chat(text))
  ipcMain.handle('ai:testKey', (_e, key: string) => svc.testKey(key))
  ipcMain.handle('ai:setKey', (_e, key: string) => svc.setApiKey(key))
  ipcMain.handle('ai:clearKey', () => svc.clearApiKey())

  ipcMain.handle('memo:list', () => svc.listMemos())
  ipcMain.handle('memo:add', (_e, content: string) => svc.addMemo(content))
  ipcMain.handle('memo:remove', (_e, id: string) => svc.removeMemo(id))

  ipcMain.handle('commands:execute', (_e, input: string) => svc.executeCommand(input))
  ipcMain.handle('commands:getHistory', () => svc.getCommandHistory())
  ipcMain.handle('commands:getSuggestions', (_e, input: string) => svc.getSuggestions(input))

  ipcMain.handle('animation:getManifest', () => svc.getManifest())
  ipcMain.handle('animation:getAsset', (_e, file: string) => svc.getAsset(file))
  ipcMain.handle('animation:trigger', (_e, event: string, context?: Record<string, unknown>) => svc.trigger(event, context))
  ipcMain.handle('animation:preview', (_e, name?: string) => svc.preview(name))
  ipcMain.handle('animation:setEnabled', (_e, v: boolean) => svc.setAnimationEnabled(v))
  ipcMain.handle('animation:getEnabled', () => svc.getAnimationEnabled())

  ipcMain.handle('emotions:get', () => svc.getEmotion())
  ipcMain.handle('emotions:notify', (_e, event: string) => svc.notifyEmotion(event))

  ipcMain.handle('minimal:get', () => svc.getMinimalMode())
  ipcMain.handle('minimal:set', (_e, v: boolean) => svc.setMinimalMode(!!v))

  ipcMain.handle('window:setPanelOpen', (_e, open: boolean) => win.setPanelOpen(open))
  ipcMain.handle('window:setInteractive', (_e, interactive: boolean) => win.setInteractive(interactive))
  ipcMain.handle('window:getPosition', () => win.getPosition())
  ipcMain.handle('window:moveBy', (_e, dx: number, dy: number) => win.moveBy(dx, dy))
  ipcMain.handle('window:resetPosition', () => win.resetPosition())

  ipcMain.handle('open:openPath', (_e, p: string) => svc.openPath(p))
  ipcMain.handle('open:openUrl', (_e, u: string) => svc.openUrl(u))
  ipcMain.handle('open:openApp', (_e, p: string) => svc.openApp(p))

  ipcMain.handle('quotes:list', () => svc.listQuotes())
  ipcMain.handle('quotes:add', (_e, q) => svc.addQuote(q))
  ipcMain.handle('quotes:update', (_e, id: string, patch) => svc.updateQuote(id, patch))
  ipcMain.handle('quotes:remove', (_e, id: string) => svc.deleteQuote(id))
  ipcMain.handle('quotes:toggle', (_e, id: string) => svc.toggleQuote(id))

  ipcMain.on('notify:emit', (_e, title: string, body: string) => { void svc.notify(title, body) })
}