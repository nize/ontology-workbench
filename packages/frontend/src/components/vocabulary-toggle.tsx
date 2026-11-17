"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { useVocabulary } from "@/hooks/use-vocabulary"
import { cn } from "@/lib/utils"

/** Switches labels between everyday words and OWL terms. Off (plain words) by default. */
export function VocabularyToggle() {
  const { vocabulary, setVocabulary } = useVocabulary()
  const owl = vocabulary === "owl"

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={owl}
      onClick={() => setVocabulary(owl ? "plain" : "owl")}
      title={owl ? "Showing OWL terms. Click for everyday words." : "Show OWL terms"}
      className={cn(
        "h-8 px-2 font-mono text-xs",
        owl ? "bg-accent text-foreground" : "text-muted-foreground"
      )}
    >
      OWL
      <span className="sr-only">{owl ? " terms on" : " terms off"}</span>
    </Button>
  )
}
