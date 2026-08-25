<script setup lang="ts">
import { onMounted } from 'vue'
import { useLingbanStore } from './store'
import PetView from './components/PetView.vue'
import Panels from './components/Panels.vue'
import Onboarding from './components/Onboarding.vue'
import SettingsModal from './components/SettingsModal.vue'
import CommandBar from './components/CommandBar.vue'

const store = useLingbanStore()

onMounted(async () => {
  await store.init()
  if (!store.onboardingDone) await window.lingban.window.setInteractive(true)
})
</script>

<template>
  <div class="app-root" :class="{ 'panel-open': !!store.panel }">
    <template v-if="!store.onboardingDone">
      <Onboarding />
    </template>
    <template v-else>
      <PetView />
      <Panels v-if="store.panel && store.panel !== 'settings'" />
      <SettingsModal v-if="store.panel === 'settings'" />
      <CommandBar v-if="store.commandOpen" />
    </template>

    <div v-if="store.toast" class="toast">
      <div class="toast-title">{{ store.toast.title }}</div>
      <div class="toast-body">{{ store.toast.body }}</div>
    </div>
    <div v-if="store.chatReply && !store.panel" class="chat-reply">{{ store.chatReply }}</div>
  </div>
</template>