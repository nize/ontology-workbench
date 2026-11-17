"use client"

import * as React from "react"
import { Languages } from "lucide-react"

import {
  languageDisplayName,
  setPreferredLanguage,
  useAvailableLanguages,
  usePreferredLanguage
} from "@/hooks/use-preferred-language"
import { cn } from "@/lib/utils"

/** Picks the language labels and definitions are shown in. Options come from the content. */
export function LanguageSelect({ workspace, className }: { workspace?: string; className?: string }) {
  const lang = usePreferredLanguage()
  const { data } = useAvailableLanguages(workspace)

  const options = React.useMemo(() => {
    const tags = data?.languages.map((item) => item.tag) ?? [data?.default ?? "en"]
    // Keep a stored choice selectable even if this workspace has no literals in it.
    if (!tags.includes(lang)) tags.push(lang)
    return tags.map((tag) => ({ tag, name: languageDisplayName(tag) }))
  }, [data, lang])

  return (
    <label
      className={cn(
        "flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
      title="Language for labels and definitions"
    >
      <Languages className="h-4 w-4 shrink-0" aria-hidden />
      <select
        aria-label="Label language"
        value={lang}
        onChange={(event) => setPreferredLanguage(event.target.value)}
        className="cursor-pointer bg-transparent font-medium text-foreground outline-none"
      >
        {options.map((option) => (
          <option key={option.tag} value={option.tag}>
            {option.name === option.tag ? option.tag : `${option.name} (${option.tag})`}
          </option>
        ))}
      </select>
    </label>
  )
}
