"use client"

type TelemetryRecord = {
  calls: number
  errors: number
  totalLatencyMs: number
}

export type TelemetrySnapshot = {
  totalCalls: number
  totalErrors: number
  avgLatencyMs: number
  byFeature: Record<string, TelemetryRecord>
}

const TELEMETRY_EVENT = "workbench:telemetry"

const state: TelemetrySnapshot = {
  totalCalls: 0,
  totalErrors: 0,
  avgLatencyMs: 0,
  byFeature: {}
}

export function recordApiMetric(feature: string, latencyMs: number, failed: boolean) {
  const target = state.byFeature[feature] ?? { calls: 0, errors: 0, totalLatencyMs: 0 }
  target.calls += 1
  if (failed) target.errors += 1
  target.totalLatencyMs += latencyMs
  state.byFeature[feature] = target

  state.totalCalls += 1
  if (failed) state.totalErrors += 1
  state.avgLatencyMs =
    state.totalCalls > 0
      ? Math.round(
          Object.values(state.byFeature).reduce((sum, item) => sum + item.totalLatencyMs, 0) / state.totalCalls
        )
      : 0

  if (process.env.NODE_ENV !== "production") {
    const status = failed ? "error" : "ok"
    // Dev-visible telemetry output requested by FE-006.
    console.info(`[telemetry] ${feature} ${status} ${latencyMs}ms`)
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TELEMETRY_EVENT))
  }
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  return {
    totalCalls: state.totalCalls,
    totalErrors: state.totalErrors,
    avgLatencyMs: state.avgLatencyMs,
    byFeature: { ...state.byFeature }
  }
}

export function onTelemetry(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(TELEMETRY_EVENT, handler)
  return () => window.removeEventListener(TELEMETRY_EVENT, handler)
}
