import { contextBridge, ipcRenderer } from 'electron'
import type { LingbanApi } from '../shared/types'

const api: LingbanApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    setAutoStart: (v) => ipcRenderer.invoke('app:setAutoStart', v),
    getAutoStart: () => ipcRenderer.invoke('app:getAutoStart'),
    reset: () => ipcRenderer.invoke('app:reset'),
    quit: () => ipcRenderer.send('app:quit')
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },
  onboarding: {
    isDone: () => ipcRenderer.invoke('onboarding:isDone'),
    complete: (data) => ipcRenderer.invoke('onboarding:complete', data)
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: (input) => ipcRenderer.invoke('tasks:create', input),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    complete: (id) => ipcRenderer.invoke('tasks:complete', id),
    reopen: (id) => ipcRenderer.invoke('tasks:reopen', id),
    archive: (id) => ipcRenderer.invoke('tasks:archive', id),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id),
    reorder: (ids) => ipcRenderer.invoke('tasks:reorder', ids)
  },
  schedule: {
    getByDate: (date) => ipcRenderer.invoke('schedule:getByDate', date),
    getRange: (start, end) => ipcRenderer.invoke('schedule:getRange', start, end),
    addManual: (date, taskId, start, end) => ipcRenderer.invoke('schedule:addManual', date, taskId, start, end),
    completeItem: (id) => ipcRenderer.invoke('schedule:completeItem', id),
    generateToday: () => ipcRenderer.invoke('schedule:generateToday'),
    confirm: (items) => ipcRenderer.invoke('schedule:confirm', items),
    updateItem: (id, patch) => ipcRenderer.invoke('schedule:updateItem', id, patch),
    removeItem: (id) => ipcRenderer.invoke('schedule:removeItem', id),
    rePlanWeek: () => ipcRenderer.invoke('schedule:rePlanWeek')
  },
  timer: {
    start: (input) => ipcRenderer.invoke('timer:start', input),
    stop: (id) => ipcRenderer.invoke('timer:stop', id),
    cancel: (id) => ipcRenderer.invoke('timer:cancel', id),
    getActive: () => ipcRenderer.invoke('timer:getActive')
  },
  diary: {
    getByDate: (date) => ipcRenderer.invoke('diary:getByDate', date),
    saveReflection: (date, text) => ipcRenderer.invoke('diary:saveReflection', date, text),
    getRange: (start, end) => ipcRenderer.invoke('diary:getRange', start, end)
  },
  focus: {
    listToday: () => ipcRenderer.invoke('focus:listToday'),
    stats: () => ipcRenderer.invoke('focus:stats')
  },
  ai: {
    generatePlan: () => ipcRenderer.invoke('ai:generatePlan'),
    generateMemory: () => ipcRenderer.invoke('ai:generateMemory'),
    review: (date) => ipcRenderer.invoke('ai:review', date),
    chat: (text) => ipcRenderer.invoke('ai:chat', text),
    testKey: (key) => ipcRenderer.invoke('ai:testKey', key),
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    clearKey: () => ipcRenderer.invoke('ai:clearKey')
  },
  memo: {
    list: () => ipcRenderer.invoke('memo:list'),
    add: (content) => ipcRenderer.invoke('memo:add', content),
    remove: (id) => ipcRenderer.invoke('memo:remove', id)
  },
  commands: {
    execute: (input) => ipcRenderer.invoke('commands:execute', input),
    getHistory: () => ipcRenderer.invoke('commands:getHistory'),
    getSuggestions: (input) => ipcRenderer.invoke('commands:getSuggestions', input)
  },
  animation: {
    getManifest: () => ipcRenderer.invoke('animation:getManifest'),
    getAsset: (file) => ipcRenderer.invoke('animation:getAsset', file),
    trigger: (event, context) => ipcRenderer.invoke('animation:trigger', event, context),
    preview: (name) => ipcRenderer.invoke('animation:preview', name),
    setEnabled: (v) => ipcRenderer.invoke('animation:setEnabled', v),
    getEnabled: () => ipcRenderer.invoke('animation:getEnabled')
  },
  emotions: {
    get: () => ipcRenderer.invoke('emotions:get'),
    notify: (event) => ipcRenderer.invoke('emotions:notify', event)
  },
  minimal: {
    get: () => ipcRenderer.invoke('minimal:get'),
    set: (v) => ipcRenderer.invoke('minimal:set', v)
  },
  window: {
    setPanelOpen: (open) => ipcRenderer.invoke('window:setPanelOpen', open),
    setInteractive: (interactive) => ipcRenderer.invoke('window:setInteractive', interactive),
    getPosition: () => ipcRenderer.invoke('window:getPosition'),
    moveBy: (dx, dy) => ipcRenderer.invoke('window:moveBy', dx, dy),
    resetPosition: () => ipcRenderer.invoke('window:resetPosition')
  },
  open: {
    openPath: (p) => ipcRenderer.invoke('open:openPath', p),
    openUrl: (u) => ipcRenderer.invoke('open:openUrl', u),
    openApp: (p) => ipcRenderer.invoke('open:openApp', p)
  },
  quotes: {
    list: () => ipcRenderer.invoke('quotes:list'),
    add: (q) => ipcRenderer.invoke('quotes:add', q),
    update: (id, patch) => ipcRenderer.invoke('quotes:update', id, patch),
    remove: (id) => ipcRenderer.invoke('quotes:remove', id),
    toggle: (id) => ipcRenderer.invoke('quotes:toggle', id)
  },
  notify: (title, body) => ipcRenderer.send('notify:emit', title, body),
  on: (channel, cb) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener as never)
    return () => ipcRenderer.removeListener(channel, listener as never)
  }
}

contextBridge.exposeInMainWorld('lingban', api)