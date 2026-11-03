"use client"

import { emitToast } from "@/lib/toast-events"
import { recordApiMetric } from "@/lib/telemetry"

// Defaults to the same-origin proxy in app/api/[...path], which lives under the
// base path like every other route; fetch() does not add it, so it is added
// here. Local dev may still point straight at the backend with
// NEXT_PUBLIC_API_BASE.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api`

type ApiFetchOptions = {
  telemetryKey: string
  retries?: number
  retryDelayMs?: number
  silentErrorToast?: boolean
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function apiGetJson<T>(path: string, options: ApiFetchOptions): Promise<T> {
  const retries = options.retries ?? 1
  const retryDelayMs = options.retryDelayMs ?? 250
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAt = Date.now()
    try {
      const response = await fetch(`${API_BASE}${path}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      recordApiMetric(options.telemetryKey, Date.now() - startedAt, false)
      return (await response.json()) as T
    } catch (error) {
      lastError = error
      const failed = attempt === retries
      recordApiMetric(options.telemetryKey, Date.now() - startedAt, true)

      if (failed) {
        if (!options.silentErrorToast) {
          emitToast({
            title: "Request failed",
            message: `${options.telemetryKey} could not be loaded.`
          })
        }
        break
      }

      await wait(retryDelayMs * (attempt + 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown API failure")
}
