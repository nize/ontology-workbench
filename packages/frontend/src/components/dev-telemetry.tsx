"use client"

import * as React from "react"

import { getTelemetrySnapshot, onTelemetry } from "@/lib/telemetry"

export function DevTelemetry() {
  const [snapshot, setSnapshot] = React.useState(() => getTelemetrySnapshot())

  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    return onTelemetry(() => setSnapshot(getTelemetrySnapshot()))
  }, [])

  if (process.env.NODE_ENV === "production") return null

  return (
    <div className="rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground">
      API {snapshot.totalCalls} req / {snapshot.totalErrors} err / {snapshot.avgLatencyMs}ms avg
    </div>
  )
}
