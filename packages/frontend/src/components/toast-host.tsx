"use client"

import * as React from "react"

import { onToast, ToastPayload } from "@/lib/toast-events"

type ToastItem = ToastPayload & { id: string }

export function ToastHost() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  React.useEffect(() => {
    return onToast((payload) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setToasts((prev) => [...prev, { ...payload, id }])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id))
      }, 3500)
    })
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed right-4 top-4 z-[100] space-y-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="w-80 rounded-md border bg-background p-3 shadow-md">
          <div className="text-sm font-semibold">{toast.title}</div>
          <div className="text-xs text-muted-foreground">{toast.message}</div>
        </div>
      ))}
    </div>
  )
}
