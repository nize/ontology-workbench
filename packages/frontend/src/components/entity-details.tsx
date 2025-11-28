"use client"

import * as React from "react"
import { Copy, ExternalLink } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useEntity } from "@/hooks/use-entity"
import { EntityDetails, LiteralValue, Restriction } from "@/types/entity"

interface EntityDetailsPanelProps {
  iri: string | null
}

export function EntityDetailsPanel({ iri }: EntityDetailsPanelProps) {
  const { data: entity, isLoading, error } = useEntity(iri)
  const router = useRouter()
  const searchParams = useSearchParams()

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const navigateToEntity = (iri: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("entity", iri)
    params.set("details", "on")
    router.push(`?${params.toString()}`)
  }

  if (!iri) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select an entity to view details
      </div>
    )
  }

  if (isLoading) {
    return <EntitySkeleton />
  }

  if (error || !entity) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        Error loading entity details
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-2xl font-bold break-words">
              {getLabel(entity)}
            </h2>
            <Badge variant="outline" className="shrink-0 uppercase">
              {entity.type}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
            <code className="flex-1 truncate" title={entity.iri}>
              {entity.iri}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => copyToClipboard(entity.iri)}
              title="Copy IRI"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* Description */}
        {entity.comment && (
          <Section title="Description">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {entity.comment.value}
            </p>
          </Section>
        )}

        {/* Superclasses */}
        {entity.superclasses && entity.superclasses.length > 0 && (
          <Section title="Superclasses">
            <div className="flex flex-wrap gap-2">
              {entity.superclasses.map((sc) => (
                <EntityChip key={sc} iri={sc} onClick={() => navigateToEntity(sc)} />
              ))}
            </div>
          </Section>
        )}

        {/* SubPropertyOf */}
        {entity.subPropertyOf && entity.subPropertyOf.length > 0 && (
          <Section title="SubProperty Of">
            <div className="flex flex-wrap gap-2">
              {entity.subPropertyOf.map((sp) => (
                <EntityChip key={sp} iri={sp} onClick={() => navigateToEntity(sp)} />
              ))}
            </div>
          </Section>
        )}

        {/* Domain */}
        {entity.domain && entity.domain.length > 0 && (
          <Section title="Domain">
            <div className="flex flex-wrap gap-2">
              {entity.domain.map((d) => (
                <EntityChip key={d} iri={d} onClick={() => navigateToEntity(d)} />
              ))}
            </div>
          </Section>
        )}

        {/* Range */}
        {entity.range && entity.range.length > 0 && (
          <Section title="Range">
            <div className="flex flex-wrap gap-2">
              {entity.range.map((r) => (
                <EntityChip key={r} iri={r} onClick={() => navigateToEntity(r)} />
              ))}
            </div>
          </Section>
        )}

        {/* Restrictions */}
        {entity.restrictions && entity.restrictions.length > 0 && (
          <Section title="Direct Restrictions">
            <div className="space-y-3">
              {entity.restrictions.map((r, i) => (
                <RestrictionItem 
                  key={i} 
                  restriction={r} 
                  onNavigate={navigateToEntity} 
                />
              ))}
            </div>
          </Section>
        )}
        
        {/* Types (for individuals) */}
        {entity.types && entity.types.length > 0 && (
          <Section title="Types">
             <div className="flex flex-wrap gap-2">
              {entity.types.map((t) => (
                <EntityChip key={t} iri={t} onClick={() => navigateToEntity(t)} />
              ))}
            </div>
          </Section>
        )}

      </div>
    </ScrollArea>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}

function EntityChip({ iri, onClick }: { iri: string; onClick: () => void }) {
  // Simple heuristic to get a display name from IRI
  const label = iri.split(/[#/]/).pop() || iri
  
  return (
    <Badge 
      variant="secondary" 
      className="cursor-pointer hover:bg-secondary/80 transition-colors"
      onClick={onClick}
    >
      {label}
    </Badge>
  )
}

function RestrictionItem({ 
  restriction, 
  onNavigate 
}: { 
  restriction: Restriction; 
  onNavigate: (iri: string) => void 
}) {
  const propertyLabel = restriction.property.split(/[#/]/).pop() || restriction.property

  let content: React.ReactNode

  if (restriction.kind === 'some' || restriction.kind === 'all') {
    content = restriction.target.type === 'iri' ? (
      <EntityChip iri={restriction.target.value} onClick={() => onNavigate(restriction.target.value)} />
    ) : (
      <span className="text-muted-foreground">{restriction.target.value}</span>
    )
  } else if (restriction.kind === 'hasValue') {
    content = restriction.value.type === 'iri' ? (
      <EntityChip iri={restriction.value.value} onClick={() => onNavigate(restriction.value.value)} />
    ) : (
      <span className="text-muted-foreground">"{restriction.value.value}"</span>
    )
  } else {
    // min, max, exact
    const r = restriction as Extract<Restriction, { kind: 'min' | 'max' | 'exact' }>;
    const target = r.target;
    content = (
      <div className="flex items-center gap-2">
        <span>{r.cardinality}</span>
        {target && (
            target.type === 'iri' ? (
              <EntityChip iri={target.value} onClick={() => onNavigate(target.value)} />
            ) : (
              <span className="text-muted-foreground">{target.value}</span>
            )
        )}
      </div>
    )
  }

  return (
    <div className="text-sm border rounded-md p-2 bg-card">
      <div className="font-medium mb-1 flex items-center gap-1">
        <span 
          className="cursor-pointer hover:underline text-primary"
          onClick={() => onNavigate(restriction.property)}
        >
          {propertyLabel}
        </span>
        <span className="text-muted-foreground text-xs">
          ({restriction.kind})
        </span>
      </div>
      
      <div className="pl-2 border-l-2 border-muted">
        {content}
      </div>
    </div>
  )
}

function getLabel(entity: EntityDetails): string {
  if (entity.labels && entity.labels.length > 0) {
    // Prefer English or no language
    const enLabel = entity.labels.find(l => l.language === 'en' || !l.language)
    return enLabel ? enLabel.value : entity.labels[0].value
  }
  // Fallback to IRI fragment
  return entity.iri.split(/[#/]/).pop() || entity.iri
}

function EntitySkeleton() {
  return (
    <div className="space-y-6 p-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Separator />
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-32" />
        </div>
      </div>
    </div>
  )
}
