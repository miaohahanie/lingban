<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLingbanStore } from '../store'

const store = useLingbanStore()
const dragging = ref(false)
const moved = ref(false)
let lastX = 0
let lastY = 0
let dragRaf = 0
let pendingDx = 0
let pendingDy = 0
// 缓存窗口穿透状态，避免每次 mousemove 都发起 IPC（IPC 往返延迟会造成点击被穿透丢失）
let interactiveState = false

function setInteractive(v: boolean): void {
  if (interactiveState === v) return
  interactiveState = v
  void window.lingban.window.setInteractive(v)
}

const assetSrc = computed(() => {
  const anim = store.currentAnimation
  if (!anim) return ''
  const a = store.manifest.find(x => x.assetId === anim.assetId)
  return a ? store.assetCache[a.file] || '' : ''
})

async function onMove(e: MouseEvent): Promise<void> {
  setInteractive(true)
  if (dragging.value) {
    if ((e.buttons & 1) === 0) { dragging.value = false; return }
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    lastX = e.screenX
    lastY = e.screenY
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.value = true
    pendingDx += dx
    pendingDy += dy
    if (!dragRaf) {
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0
        const fx = pendingDx
        const fy = pendingDy
        pendingDx = 0
        pendingDy = 0
        if (fx || fy) void window.lingban.window.moveBy(fx, fy)
      })
    }
  }
}

function onMouseLeave(): void {
  // 面板/命令框/设置打开时保持窗口可交互，避免离开桌宠区域导致点击失效
  if (store.panel || store.commandOpen) return
  if (!dragging.value) setInteractive(false)
}

function onMouseDown(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (el.closest('.bubbles, .command-bar, .panel-overlay, .modal-overlay')) return
  dragging.value = true
  moved.value = false
  lastX = e.screenX
  lastY = e.screenY
}

function onMouseUp(): void {
  dragging.value = false
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0 }
  pendingDx = 0
  pendingDy = 0
  setInteractive(true)
  setTimeout(() => { moved.value = false }, 0)
}

onMounted(() => { window.addEventListener('mouseup', onMouseUp) })
onBeforeUnmount(() => { window.removeEventListener('mouseup', onMouseUp) })

async function onClick(): Promise<void> {
  if (moved.value) return
  await store.clickInteract()
}

function onDblClick(): void {
  store.toggleCommand(true)
}
</script>

<template>
  <div class="pet-wrap" @mousemove="onMove" @mouseleave="onMouseLeave">
    <div
      class="pet-stage interactive"
      @mousedown="onMouseDown"
      @mouseup="onMouseUp"
      @click="onClick"
      @dblclick="onDblClick"
    >
      <img v-if="assetSrc" :src="assetSrc" alt="灵伴" />
      <svg v-else viewBox="0 0 200 200" style="width:100%;height:100%">
        <defs>
          <radialGradient id="petBg" cx="50%" cy="35%" r="75%">
            <stop offset="0%" stop-color="#b9c9f5"/>
            <stop offset="100%" stop-color="#7d9ae4"/>
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="80" fill="url(#petBg)" stroke="#5b6a8c" stroke-width="4"/>
        <path d="M40 70 Q30 40 58 52" fill="none" stroke="#5b6a8c" stroke-width="6" stroke-linecap="round"/>
        <path d="M160 70 Q170 40 142 52" fill="none" stroke="#5b6a8c" stroke-width="6" stroke-linecap="round"/>
        <circle cx="72" cy="92" r="10" fill="#26324e"/>
        <circle cx="128" cy="92" r="10" fill="#26324e"/>
        <circle cx="76" cy="88" r="3" fill="#fff"/>
        <circle cx="132" cy="88" r="3" fill="#fff"/>
        <path d="M82 128 Q100 144 118 128" fill="none" stroke="#26324e" stroke-width="5" stroke-linecap="round"/>
        <circle cx="62" cy="118" r="8" fill="#f7b8c4" opacity=".8"/>
        <circle cx="138" cy="118" r="8" fill="#f7b8c4" opacity=".8"/>
      </svg>
    </div>
    <div v-if="store.currentCaption && !store.panel" :key="store.captionKey" class="pet-bubble">{{ store.currentCaption }}</div>
    <div class="pet-name">灵伴</div>
    <div class="pet-emotion">心情：{{ store.emotion }}</div>
    <div class="pet-click-hint">单击互动 · 按住拖动 · 双击呼出指令</div>
    <div v-if="store.timer.active" class="mini-timer interactive">
      <span class="mini-timer-time">⏱ {{ store.timerText }}</span>
      <div class="mini-timer-bar"><div class="mini-timer-fill" :style="{ width: (store.timerProgress * 100) + '%' }"></div></div>
    </div>

    <div class="bubbles interactive">
      <button class="bubble" title="任务栏" @click="store.openPanel('tasks')">📋</button>
      <button class="bubble" title="日记本" @click="store.openPanel('diary')">📖</button>
      <button class="bubble" title="计时器" @click="store.openPanel('timer')">⏱️</button>
      <button class="bubble" title="日历" @click="store.openPanel('calendar')">📅</button>
    </div>
  </div>
</template>