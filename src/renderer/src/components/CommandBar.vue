<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useLingbanStore } from '../store'

const store = useLingbanStore()
const historyIndex = ref(-1)

// 点击指令框外部时自动关闭（popover 行为），避免常驻占位
function onDocMouseDown(e: MouseEvent): void {
  const el = e.target as HTMLElement | null
  if (el && el.closest('.command-bar')) return
  store.toggleCommand(false)
}
onMounted(() => { document.addEventListener('mousedown', onDocMouseDown) })
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDocMouseDown) })

async function onInput(): Promise<void> {
  // 预设指令默认隐藏，只有输入 /help 时才显示
  if (store.commandText.trim().startsWith('/help') || store.commandText.trim() === '/') {
    await store.updateSuggestions(store.commandText.trim() === '/' ? '/' : '')
  } else {
    store.suggestions = []
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    void submit()
  } else if (e.key === 'Escape') {
    store.toggleCommand(false)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    historyIndex.value = Math.min(historyIndex.value + 1, store.history.length - 1)
    if (store.history[historyIndex.value] !== undefined) store.commandText = store.history[historyIndex.value]
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    historyIndex.value = Math.max(historyIndex.value - 1, -1)
    if (historyIndex.value >= 0) store.commandText = store.history[historyIndex.value]
    else store.commandText = ''
  }
}

async function submit(): Promise<void> {
  const text = store.commandText.trim()
  if (!text) return
  store.commandText = ''
  historyIndex.value = -1
  const res = await store.executeCommand(text)
  if (res.action?.startsWith('panel:')) {
    const panel = res.action.split(':')[1]
    await store.openPanel(panel as never)
    store.toggleCommand(false)
  } else if (res.action === 'chat') {
    store.toggleCommand(false)
  } else if (res.action === 'help') {
    store.toast = { title: '预设指令', body: res.message || '' }
    setTimeout(() => { store.toast = null }, 5000)
  } else if (res.action === 'open' || res.action === 'memo' || res.action === 'review' || res.action === 'animation') {
    store.toast = { title: '指令完成', body: res.message || '完成' }
    setTimeout(() => { store.toast = null }, 2500)
    if (res.action === 'animation') store.toggleCommand(false)
  } else if (!res.ok) {
    store.toast = { title: '提示', body: res.message || '操作失败' }
    setTimeout(() => { store.toast = null }, 3500)
  }
  await store.updateSuggestions('')
}
</script>

<template>
  <div class="command-bar interactive">
    <input
      class="command-input"
      v-model="store.commandText"
      placeholder="输入 /指令 或聊天… 输入 /help 查看预设指令"
      @input="onInput"
      @keydown="onKeydown"
      autofocus
    />
    <div v-if="store.commandText.trim().startsWith('/help') && store.suggestions.length" class="suggestions">
      <button
        v-for="s in store.suggestions"
        :key="s"
        class="suggestion-chip"
        @click="store.commandText = s; onInput()"
      >{{ s }}</button>
    </div>
  </div>
</template>