"use client"

import * as React from "react"
import cytoscape from "cytoscape"
import elk from "cytoscape-elk"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, Layers, Loader2, ZoomIn, ZoomOut, Maximize } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { readRadius, updateUrlParams } from "@/lib/url-state"
import { useDiagram } from "@/hooks/use-diagram"
import { useVocabulary } from "@/hooks/use-vocabulary"
import { applyHiddenNodes, edgeLabel, type HiddenNode } from "@/lib/diagram-hide"

// Register ELK extension
cytoscape.use(elk)

const DEFAULT_VIEW_MIN_ZOOM = 1.0
const DEFAULT_VIEW_MAX_ZOOM = 1.15
const SINGLE_NODE_DEFAULT_ZOOM = 1.1
const MIN_ZOOM = 0.2
const MAX_ZOOM = 3
/** How long the hide button lingers after the pointer leaves a node. */
const HOVER_HIDE_DELAY_MS = 250

interface HoverTarget {
  id: string
  x: number
  y: number
}

interface DiagramViewProps {
  iri: string
  workspace?: string
}

export function DiagramView({ iri, workspace }: DiagramViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const cyRef = React.useRef<cytoscape.Core | null>(null)
  const [radius, setRadius] = React.useState<number>(readRadius(searchParams))
  // Most recently hidden last; rendered as a stack with the newest on top.
  const [hiddenNodes, setHiddenNodes] = React.useState<HiddenNode[]>([])
  const [stackOpen, setStackOpen] = React.useState(false)
  const [hover, setHover] = React.useState<HoverTarget | null>(null)
  const hoverIdRef = React.useRef<string | null>(null)
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderedDataRef = React.useRef<unknown>(null)

  const hiddenIds = React.useMemo(() => new Set(hiddenNodes.map((n) => n.id)), [hiddenNodes])

  const cancelHoverHide = React.useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const clearHover = React.useCallback(() => {
    cancelHoverHide()
    hoverIdRef.current = null
    setHover(null)
  }, [cancelHoverHide])

  const scheduleHoverHide = React.useCallback(() => {
    cancelHoverHide()
    hoverTimerRef.current = setTimeout(clearHover, HOVER_HIDE_DELAY_MS)
  }, [cancelHoverHide, clearHover])

  const showHoverFor = React.useCallback((node: cytoscape.NodeSingular) => {
    const box = node.renderedBoundingBox({})
    hoverIdRef.current = node.id()
    setHover({ id: node.id(), x: box.x2, y: box.y1 })
  }, [])

  const hideNode = React.useCallback((id: string) => {
    const node = cyRef.current?.getElementById(id)
    if (!node || node.empty()) return
    setHiddenNodes((prev) =>
      prev.some((n) => n.id === id)
        ? prev
        : [...prev, { id, label: node.data("label"), kind: node.data("kind") }]
    )
    clearHover()
  }, [clearHover])

  const restoreNode = React.useCallback((id: string) => {
    setHiddenNodes((prev) => prev.filter((n) => n.id !== id))
  }, [])

  React.useEffect(() => {
    if (hiddenNodes.length === 0) setStackOpen(false)
  }, [hiddenNodes.length])

  React.useEffect(() => cancelHoverHide, [cancelHoverHide])

  React.useEffect(() => {
    setRadius(readRadius(searchParams))
  }, [searchParams])

  const normalizeViewport = React.useCallback(() => {
    const cy = cyRef.current
    if (!cy) return

    const nodeCount = cy.nodes().length
    const edgeCount = cy.edges().length
    const elements = cy.elements()

    if (nodeCount <= 1) {
      cy.zoom(SINGLE_NODE_DEFAULT_ZOOM)
      cy.center(elements)
      return
    }

    cy.fit(elements, 50)
    const minZoom = nodeCount <= 8 ? DEFAULT_VIEW_MIN_ZOOM : 0.75
    const maxZoom = DEFAULT_VIEW_MAX_ZOOM
    const nextZoom = Math.max(minZoom, Math.min(maxZoom, cy.zoom()))

    if (Math.abs(nextZoom - cy.zoom()) > 0.001) {
      cy.zoom(nextZoom)
    }
    cy.center(elements)
  }, [])

  const { data, isLoading, error, refetch } = useDiagram(iri, radius, workspace)
  const { t } = useVocabulary()

  const zoomAndRecenter = React.useCallback((factor: number) => {
    const cy = cyRef.current
    if (!cy) return

    const container = cy.container()
    const nextLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cy.zoom() * factor))

    if (container) {
      cy.zoom({
        level: nextLevel,
        renderedPosition: {
          x: container.clientWidth / 2,
          y: container.clientHeight / 2
        }
      })
    } else {
      cy.zoom(nextLevel)
    }

    cy.center(cy.elements())
  }, [])

  // Initialize Cytoscape
  React.useEffect(() => {
    if (isLoading || !containerRef.current) return

    // Only initialize if not already initialized
    if (!cyRef.current) {
      cyRef.current = cytoscape({
        container: containerRef.current,
        wheelSensitivity: 0.2,
      })

      // Add ResizeObserver
      const ro = new ResizeObserver(() => {
        if (cyRef.current) {
          cyRef.current.resize()
          normalizeViewport()
        }
      })
      ro.observe(containerRef.current)

      cyRef.current.on("tap", "node", (evt) => {
        const node = evt.target
        const nodeIri = node.data("iri")
        if (nodeIri) {
          const params = updateUrlParams(searchParams, {
            center: nodeIri,
            entity: nodeIri,
            pane: "diagram",
            details: "on"
          })
          router.push(`?${params.toString()}`)
        }
      })

      cyRef.current.on("mouseover", "node", (evt) => {
        const node = evt.target as cytoscape.NodeSingular
        cancelHoverHide()
        if (node.data("isCenter")) {
          clearHover()
          return
        }
        showHoverFor(node)
      })
      cyRef.current.on("mouseout", "node", () => scheduleHoverHide())
      // Keep the hide button glued to the node while the view moves.
      cyRef.current.on("pan zoom position", () => {
        const id = hoverIdRef.current
        const node = id ? cyRef.current?.getElementById(id) : undefined
        if (node && node.nonempty()) showHoverFor(node)
      })
      cyRef.current.on("grab", "node", () => clearHover())

      // Cleanup function for when the component unmounts
      // We attach it to the ref so we can clean it up later if needed, 
      // but actually the useEffect cleanup is better.
      // However, since we only want to init ONCE, we need to be careful.
    }
    
    // We don't destroy here because we want to persist the instance across theme changes
    // But we need to handle unmount.
    // Let's use a separate effect for cleanup or just check if container is still valid.

  }, [isLoading, normalizeViewport, cancelHoverHide, clearHover, scheduleHoverHide, showHoverFor]) // Run when loading finishes

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
    }
  }, [])

  // Update Styles when Theme changes
  React.useEffect(() => {
    if (!cyRef.current) return

    const isDark = theme === 'dark'
    const colors = {
      bg: isDark ? '#020817' : '#f8fafc', // slate-950 : slate-50
      nodeBg: isDark ? '#1e293b' : '#ffffff', // slate-800 : white
      nodeBorder: isDark ? '#475569' : '#94a3b8', // slate-600 : slate-400
      nodeColor: isDark ? '#f8fafc' : '#0f172a', // slate-50 : slate-900
      centerBg: isDark ? '#0c4a6e' : '#e0f2fe', // sky-900 : sky-100
      centerBorder: isDark ? '#38bdf8' : '#0284c7', // sky-400 : sky-600
      edgeColor: isDark ? '#64748b' : '#94a3b8', // slate-500 : slate-400
      edgeLabelBg: isDark ? '#020817' : '#ffffff', // slate-950 : white
      edgeLabelColor: isDark ? '#94a3b8' : '#64748b', // slate-400 : slate-500
      individualBg: isDark ? '#2e1065' : '#f5f3ff', // violet-950 : violet-50
      individualBorder: isDark ? '#a78bfa' : '#7c3aed', // violet-400 : violet-600
      individualColor: isDark ? '#ede9fe' : '#4c1d95', // violet-100 : violet-900
      individualCenterBg: isDark ? '#4c1d95' : '#ddd6fe', // violet-900 : violet-200
      individualEdge: isDark ? '#8b5cf6' : '#a78bfa', // violet-500 : violet-400
      derivedEdge: isDark ? '#f59e0b' : '#d97706', // amber-500 : amber-600
    }

    cyRef.current.style([
        {
          selector: "node",
          style: {
            "background-color": colors.nodeBg,
            "border-width": 1,
            "border-color": colors.nodeBorder,
            "label": "data(label)",
            "color": colors.nodeColor,
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "12px",
            "font-weight": "normal",
            "width": "label",
            "height": "label",
            "padding": "12px",
            "shape": "round-rectangle",
            "text-wrap": "wrap",
            "text-max-width": "120px",
            "text-justification": "center",
            "line-height": 1.2,
          }
        },
        {
          selector: "node[?isCenter]",
          style: {
            "background-color": colors.centerBg,
            "border-color": colors.centerBorder,
            "border-width": 2,
            "font-weight": "bold",
            "color": isDark ? '#f0f9ff' : '#0c4a6e',
          }
        },
        {
          selector: "node[kind='individual']",
          style: {
            "background-color": colors.individualBg,
            "border-color": colors.individualBorder,
            "border-width": 1.5,
            "color": colors.individualColor,
            "font-style": "italic",
            "shape": "ellipse",
            "padding": "16px",
          }
        },
        {
          selector: "node[kind='individual'][?isCenter]",
          style: {
            "background-color": colors.individualCenterBg,
            "border-width": 2.5,
            "font-weight": "bold",
          }
        },
        {
          selector: "edge",
          style: {
            "width": 1.5,
            "line-color": colors.edgeColor,
            "target-arrow-color": colors.edgeColor,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "label": "data(label)",
            "color": colors.edgeLabelColor,
            "font-size": "10px",
            "text-rotation": "none",
            "text-background-color": colors.edgeLabelBg,
            "text-background-opacity": 1,
            "text-background-padding": "4px",
            "text-background-shape": "roundrectangle",
            "target-label": "data(cardinalityLabel)",
            "target-text-offset": 30,
            "text-wrap": "wrap",
            "text-max-width": "200px",
          }
        },
        {
          selector: "edge[kind='some']",
          style: { "line-style": "solid" }
        },
        {
          selector: "edge[kind='all']",
          style: { "line-style": "solid" }
        },
        {
          selector: "edge[kind='instanceOf']",
          style: {
            "line-style": "dashed",
            "line-dash-pattern": [6, 4],
            "line-color": colors.individualEdge,
            "target-arrow-color": colors.individualEdge,
            "target-arrow-shape": "triangle",
            "target-arrow-fill": "hollow",
            "font-style": "italic",
          }
        },
        {
          selector: "edge[kind='assertion']",
          style: {
            "line-color": colors.individualEdge,
            "target-arrow-color": colors.individualEdge,
          }
        },
        {
          selector: "edge[kind='derived']",
          style: {
            "line-style": "dotted",
            "width": 2,
            "line-color": colors.derivedEdge,
            "target-arrow-color": colors.derivedEdge,
            "color": colors.derivedEdge,
            "font-style": "italic",
          }
        }
      ])
  }, [theme, isLoading]) // Update style when theme changes or after init

  // Update Data & Layout
  React.useEffect(() => {
    const cy = cyRef.current
    if (!cy || !data) return

    // Only hiding/restoring changed: keep the positions the user already sees.
    const sameData = renderedDataRef.current === data
    renderedDataRef.current = data

    if (hoverIdRef.current && hiddenIds.has(hoverIdRef.current)) clearHover()

    const visible = applyHiddenNodes(data, hiddenIds)

    const nodes = visible.nodes.map(n => ({
      data: { 
        id: n.id, 
        iri: n.iri, 
        label: n.label,
        isCenter: n.isCenter,
        kind: n.kind ?? 'class'
      }
    }))

    const edges = visible.edges.map(e => {
      const label = edgeLabel(e)
      // Format cardinality
      let card = ''
      if (e.kind === 'some') card = '1..*'
      else if (e.kind === 'all') card = '0..*'
      else if (e.kind === 'min' && e.cardinality !== undefined) card = `${e.cardinality}..*`
      else if (e.kind === 'max' && e.cardinality !== undefined) card = `0..${e.cardinality}`
      else if (e.kind === 'exact' && e.cardinality !== undefined) card = `${e.cardinality}`
      else if (e.kind === 'hasValue') card = '1'
      
      return {
        data: { 
          id: e.id, 
          source: e.source, 
          target: e.target, 
          label: label,
          cardinalityLabel: card ? `[${card}]` : '',
          kind: e.kind
        }
      }
    })

    const derivedEdges = visible.derivedEdges.map(e => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.properties.join(' → ')}\nvia ${e.via.join(', ')}`,
        cardinalityLabel: '',
        kind: 'derived'
      }
    }))

    const all = [...nodes, ...edges, ...derivedEdges]

    if (sameData) {
      // Diff instead of rebuilding: elements that stay are left untouched, so
      // they keep their positions and Cytoscape's cached render state.
      const wanted = new Set(all.map((el) => el.data.id))
      cy.elements().filter((el) => !wanted.has(el.id())).remove()
      const added = cy.add(all.filter((el) => cy.getElementById(el.data.id).empty()))
      const restored = added.nodes()
      // Nothing came back: the remaining nodes stay exactly where they were.
      if (restored.empty()) return
      // Restored nodes start next to their visible neighbours, then settle.
      restored.forEach((n) => {
        let x = 0, y = 0, count = 0
        n.neighborhood().nodes().difference(restored).forEach((m) => {
          x += m.position("x")
          y += m.position("y")
          count += 1
        })
        if (count > 0) n.position({ x: x / count + 40, y: y / count + 40 })
      })
    } else {
      cy.elements().remove()
      cy.add(all)
    }

    const layoutName = edges.length + derivedEdges.length === 0 ? "grid" : "cose"

    const layout = cy.layout({
      name: layoutName,
      animate: true,
      animationDuration: 500,
      fit: false,
      padding: 50,
      // cose options
      // @ts-ignore
      componentSpacing: 100,
      nodeOverlap: 20,
      refresh: 20,
      randomize: false,
      nodeRepulsion: 400000,
      idealEdgeLength: 100,
      edgeElasticity: 100,
      nestingFactor: 5,
      gravity: 80,
      numIter: 1000,
      initialTemp: 200,
      coolingFactor: 0.95,
      minTemp: 1.0
    })

    layout.on("layoutstop", () => {
      // Prevent tiny graphs from being aggressively zoomed in.
      normalizeViewport()
    })
    layout.run()

  }, [data, hiddenIds, normalizeViewport, clearHover])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        <div className="text-center space-y-2">
          <div>Error loading diagram.</div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
      <div ref={containerRef} className="h-full w-full" />
      
      {hover && !hiddenIds.has(hover.id) && (
        <button
          type="button"
          aria-label="Hide node"
          title="Hide node"
          className="absolute z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          style={{ left: hover.x, top: hover.y }}
          onMouseEnter={cancelHoverHide}
          onMouseLeave={scheduleHoverHide}
          onClick={() => hideNode(hover.id)}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Hidden stack */}
      {hiddenNodes.length > 0 && (
        <div className="absolute top-[4.5rem] right-4 z-10 w-56 text-xs">
          <button
            type="button"
            className="relative w-full text-left"
            aria-expanded={stackOpen}
            onClick={() => setStackOpen((open) => !open)}
          >
            {hiddenNodes.length > 1 && (
              <div className="absolute inset-x-1 -bottom-1 h-full rounded-md border bg-background/80 shadow-sm" />
            )}
            {hiddenNodes.length > 2 && (
              <div className="absolute inset-x-2 -bottom-2 h-full -z-10 rounded-md border bg-background/60 shadow-sm" />
            )}
            <div className="relative flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 shadow-sm hover:bg-muted">
              <Layers className="h-4 w-4 shrink-0" />
              <span className="font-medium">{hiddenNodes.length} hidden</span>
              <span className="ml-auto truncate text-muted-foreground">
                {hiddenNodes[hiddenNodes.length - 1].label}
              </span>
            </div>
          </button>
          {stackOpen && (
            <div className="mt-3 rounded-md border bg-background/95 shadow-sm">
              <ul className="max-h-64 overflow-y-auto py-1">
                {[...hiddenNodes].reverse().map((n) => {
                  const inView = data?.nodes.some((d) => d.id === n.id) ?? false
                  return (
                    <li key={n.id} className="flex items-center gap-2 px-3 py-1">
                      <span
                        className={cn("truncate", n.kind === "individual" && "italic", !inView && "text-muted-foreground")}
                        title={inView ? n.label : `${n.label} (not in this diagram)`}
                      >
                        {n.label}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-6 w-6 shrink-0"
                        aria-label={`Show ${n.label}`}
                        title="Show node"
                        onClick={() => restoreNode(n.id)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
              <div className="border-t px-3 py-1.5">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setHiddenNodes([])}
                >
                  Show all
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      
      {/* Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2 bg-background/90 p-2 rounded-md shadow-sm border">
        <span className="text-xs font-medium mr-1">Radius:</span>
        <div className="flex items-center border rounded-md overflow-hidden">
          <button
            className={cn("px-2 py-1 text-xs hover:bg-muted", radius === 1 && "bg-primary text-primary-foreground")}
            onClick={() => {
              const nextRadius = 1
              setRadius(nextRadius)
              const params = updateUrlParams(searchParams, { radius: String(nextRadius) })
              router.replace(`?${params.toString()}`)
            }}
          >
            1
          </button>
          <div className="w-px h-full bg-border" />
          <button
            className={cn("px-2 py-1 text-xs hover:bg-muted", radius === 2 && "bg-primary text-primary-foreground")}
            onClick={() => {
              const nextRadius = 2
              setRadius(nextRadius)
              const params = updateUrlParams(searchParams, { radius: String(nextRadius) })
              router.replace(`?${params.toString()}`)
            }}
          >
            2
          </button>
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => cyRef.current?.fit()}>
          <Maximize className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAndRecenter(1.2)}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAndRecenter(1 / 1.2)}>
          <ZoomOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-background/90 p-3 rounded-md shadow-sm border text-xs space-y-2">
        <div className="font-semibold mb-1">Legend</div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-blue-600 bg-blue-100 rounded-sm" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-gray-500 bg-white rounded-sm" />
          <span>{t("class")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-violet-600 bg-violet-50 dark:bg-violet-950 rounded-full" />
          <span className="italic">{t("individual")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-px bg-gray-400" />
          <span>{t("restriction")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 border-t border-dashed border-violet-500" />
          <span>{t("instanceOf")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-px bg-violet-400" />
          <span>{t("propertyAssertion")}</span>
        </div>
        {hiddenNodes.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-8 border-t-2 border-dotted border-amber-600 dark:border-amber-500" />
            <span className="italic">Derived (via hidden)</span>
          </div>
        )}
      </div>

      {!isLoading && data?.truncated && (
        <div className="absolute bottom-4 right-4 rounded-md border bg-background/90 px-3 py-2 text-xs text-muted-foreground max-w-xs">
          Not everything is shown. The details panel lists all {t("individuals").toLowerCase()} of a {t("class").toLowerCase()}.
        </div>
      )}

      {!isLoading && data && data.edges.length === 0 && (
        <div className="absolute bottom-4 right-4 rounded-md border bg-background/90 px-3 py-2 text-xs text-muted-foreground">
          No relationships found for this entity at radius {radius}.
        </div>
      )}
    </div>
  )
}
