"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { DEFAULT_LANGUAGE, LanguagesResponse, normalizeLanguage } from "@acme/shared"

import { apiGetJson } from "@/lib/api"

const STORAGE_KEY = "ontology-workbench:language"
const CHANGE_EVENT = "workbench:language"

let memoryFallback: string | null = null

function read(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? normalizeLanguage(stored) : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onStorage)
  }
}

export function setPreferredLanguage(lang: string) {
  const normalized = normalizeLanguage(lang)
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized)
  } catch {
    // Storage blocked: the choice still applies until reload.
    memoryFallback = normalized
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/**
 * Preferred language for labels and definitions (a BCP 47 tag, English by default).
 * Every API call that returns labels passes it as `lang`, and includes it in its query key.
 */
export function usePreferredLanguage(): string {
  return React.useSyncExternalStore(
    subscribe,
    () => memoryFallback ?? read(),
    () => DEFAULT_LANGUAGE
  )
}

export function languagesQueryKey(workspace?: string) {
  return ["languages", workspace] as const
}

/** Language tags that occur on labels and definitions in the workspace. */
export function useAvailableLanguages(workspace?: string) {
  return useQuery({
    queryKey: languagesQueryKey(workspace),
    queryFn: () => {
      const params = new URLSearchParams()
      if (workspace) params.set("workspace", workspace)
      const query = params.toString()
      return apiGetJson<LanguagesResponse>(`/languages${query ? `?${query}` : ""}`, {
        telemetryKey: "languages",
        silentErrorToast: true
      })
    },
    staleTime: 10 * 60 * 1000
  })
}

/** Human-readable name of a language tag in that language itself, e.g. `sv` → "svenska". */
export function languageDisplayName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag)
    if (name && name.toLowerCase() !== tag.toLowerCase()) {
      return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1)
    }
  } catch {
    // Unknown or private-use tag: show it as is.
  }
  return tag
}
