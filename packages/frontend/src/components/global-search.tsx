"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, Loader2, FileText, Box, Layers, X } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { SearchResponse, EntityType, SearchHit } from "@acme/shared"

import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiGetJson } from "@/lib/api"
import { diagramQueryKey, fetchDiagram } from "@/hooks/use-diagram"
import { entityQueryKey, fetchEntity } from "@/hooks/use-entity"
import { readRadius, readWorkspace, updateUrlParams } from "@/lib/url-state"

async function fetchSearchResults(query: string, workspace?: string): Promise<SearchResponse> {
  if (!query) return { query: "", limit: 10, offset: 0, total: 0, hits: [] }

  const params = new URLSearchParams()
  params.set("q", query)
  params.set("limit", "10")
  if (workspace) params.set("workspace", workspace)
  return apiGetJson<SearchResponse>(`/search?${params.toString()}`, {
    telemetryKey: "search.global",
    silentErrorToast: true
  })
}

const TypeIcon = ({ type }: { type: EntityType }) => {
  switch (type) {
    case 'class': return <Layers className="h-4 w-4 text-blue-500" />
    case 'property': return <Box className="h-4 w-4 text-green-500" />
    case 'individual': return <FileText className="h-4 w-4 text-orange-500" />
    default: return <FileText className="h-4 w-4" />
  }
}

export const GlobalSearch = React.forwardRef<HTMLInputElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const router = useRouter()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const workspace = readWorkspace(searchParams)
    const radius = readRadius(searchParams)
    const [query, setQuery] = React.useState("")
    const [isOpen, setIsOpen] = React.useState(false)
    const [selectedIndex, setSelectedIndex] = React.useState(-1)
    const containerRef = React.useRef<HTMLDivElement>(null)
    
    const debouncedQuery = useDebounce(query, 300)

    const { data, isLoading, isError, refetch } = useQuery({
      queryKey: ["search", debouncedQuery, workspace],
      queryFn: () => fetchSearchResults(debouncedQuery, workspace),
      enabled: debouncedQuery.length > 0,
      staleTime: 1000 * 60, // 1 minute
    })

    const hits = data?.hits || []

    // Reset selection when results change
    React.useEffect(() => {
      setSelectedIndex(-1)
    }, [hits.length])

    // Handle click outside
    React.useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsOpen(false)
        }
      }
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const handleSelect = (hit: SearchHit) => {
      setIsOpen(false)
      setQuery("") // Optional: clear query on select
      const params = updateUrlParams(searchParams, {
        center: hit.iri,
        entity: hit.iri,
        pane: "diagram",
        details: "on"
      })
      router.push(`?${params.toString()}`)
    }

    const handlePrefetch = (hit: SearchHit) => {
      queryClient.prefetchQuery({
        queryKey: entityQueryKey(hit.iri, workspace),
        queryFn: () => fetchEntity(hit.iri, workspace)
      })
      queryClient.prefetchQuery({
        queryKey: diagramQueryKey(hit.iri, radius, workspace),
        queryFn: () => fetchDiagram(hit.iri, radius, workspace)
      })
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!isOpen || hits.length === 0) return

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % hits.length)
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + hits.length) % hits.length)
          break
        case "Enter":
          e.preventDefault()
          if (selectedIndex >= 0 && selectedIndex < hits.length) {
            handleSelect(hits[selectedIndex])
          }
          break
        case "Escape":
          setIsOpen(false)
          break
      }
    }

    const handleFocus = () => {
      if (query.length > 0) setIsOpen(true)
    }

    const handleClear = () => {
      setQuery("")
      setIsOpen(false)
      // Keep focus on input?
    }

    return (
      <div ref={containerRef} className={cn("relative w-full max-w-xl", className)} {...props}>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={ref}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (e.target.value.length > 0) setIsOpen(true)
              else setIsOpen(false)
            }}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder="Search... (Cmd+K)"
            className="w-full h-9 pl-8 pr-8 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {query.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {isOpen && (query.length > 0) && (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 z-50 overflow-hidden">
            {isLoading ? (
              <div className="p-4 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Searching...
              </div>
            ) : isError ? (
              <div className="p-4 text-center text-sm text-destructive space-y-2">
                <div>Search request failed.</div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : hits.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No results found.
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto py-1">
                {hits.map((hit, index) => (
                  <div
                    key={hit.iri}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                      index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
                    )}
                    onClick={() => handleSelect(hit)}
                    onMouseEnter={() => {
                      setSelectedIndex(index)
                      handlePrefetch(hit)
                    }}
                  >
                    <div className="mt-1 shrink-0">
                      <TypeIcon type={hit.type} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate text-sm">
                          {hit.label}
                        </span>
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 uppercase shrink-0">
                          {hit.type}
                        </Badge>
                      </div>
                      
                      {hit.highlights && hit.highlights.length > 0 ? (
                        <div 
                          className="text-xs text-muted-foreground line-clamp-2 [&>mark]:bg-yellow-200 [&>mark]:text-black [&>mark]:rounded-sm [&>mark]:px-0.5"
                          dangerouslySetInnerHTML={{ __html: hit.highlights[0].snippet }}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {hit.comment || hit.iri}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
)
GlobalSearch.displayName = "GlobalSearch"
