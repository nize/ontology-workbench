"use client"

import { ReadonlyURLSearchParams } from "next/navigation"

export function readCenter(searchParams: ReadonlyURLSearchParams): string | null {
  return searchParams.get("center") ?? searchParams.get("entity")
}

export function readPane(searchParams: ReadonlyURLSearchParams): "diagram" | "search" {
  const pane = searchParams.get("pane")
  return pane === "search" ? "search" : "diagram"
}

export function readRadius(searchParams: ReadonlyURLSearchParams): number {
  const radiusParam = searchParams.get("radius")
  const parsed = radiusParam ? Number.parseInt(radiusParam, 10) : 1
  if (!Number.isFinite(parsed)) return 1
  return Math.min(2, Math.max(1, parsed))
}

export function readWorkspace(searchParams: ReadonlyURLSearchParams): string | undefined {
  return searchParams.get("workspace") ?? undefined
}

export function updateUrlParams(
  searchParams: ReadonlyURLSearchParams,
  updates: Record<string, string | undefined | null>
): URLSearchParams {
  const next = new URLSearchParams(searchParams.toString())
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === "") {
      next.delete(key)
    } else {
      next.set(key, value)
    }
  }
  return next
}
