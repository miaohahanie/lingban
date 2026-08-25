/// <reference types="vite/client" />
import type { LingbanApi } from '../../shared/types'

declare global {
  interface Window {
    lingban: LingbanApi
  }
}

export {}
