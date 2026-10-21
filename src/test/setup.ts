import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test-image', configurable: true })
Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true })
Object.defineProperty(window, 'matchMedia', {
  value: (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  }),
  configurable: true
})
Object.defineProperty(globalThis, 'ResizeObserver', {
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  configurable: true
})

afterEach(cleanup)
