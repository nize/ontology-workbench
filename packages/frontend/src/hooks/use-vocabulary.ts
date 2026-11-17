"use client"

import * as React from "react"

import { DEFAULT_VOCABULARY, term, type TermKey, type Vocabulary } from "@/lib/terms"

const STORAGE_KEY = "ontology-workbench:vocabulary"
const CHANGE_EVENT = "workbench:vocabulary"

function read(): Vocabulary {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === "owl" || stored === "plain" ? stored : DEFAULT_VOCABULARY
  } catch {
    return DEFAULT_VOCABULARY
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

export function setVocabulary(vocabulary: Vocabulary) {
  try {
    window.localStorage.setItem(STORAGE_KEY, vocabulary)
  } catch {
    // Storage blocked: the choice still applies until reload.
    memoryFallback = vocabulary
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

let memoryFallback: Vocabulary | null = null

/** Current wording (plain everyday words by default, OWL terms when switched on). */
export function useVocabulary() {
  const vocabulary = React.useSyncExternalStore(
    subscribe,
    () => memoryFallback ?? read(),
    () => DEFAULT_VOCABULARY
  )
  const t = React.useCallback((key: TermKey) => term(key, vocabulary), [vocabulary])
  return { vocabulary, t, setVocabulary }
}
