"use client"

export type ToastPayload = {
  title: string
  message: string
}

const TOAST_EVENT = "workbench:toast"

export function emitToast(payload: ToastPayload) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }))
}

export function onToast(handler: (payload: ToastPayload) => void): () => void {
  if (typeof window === "undefined") return () => {}

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<ToastPayload>
    if (customEvent.detail) {
      handler(customEvent.detail)
    }
  }

  window.addEventListener(TOAST_EVENT, listener)
  return () => window.removeEventListener(TOAST_EVENT, listener)
}
