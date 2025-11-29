"use client"

import * as React from "react"
import cytoscape from "cytoscape"
import elk from "cytoscape-elk"
import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, ZoomIn, ZoomOut, Maximize, Minimize } from "lucide-react"
import { DiagramResponse, DiagramNode, DiagramEdge } from "@acme/shared"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Register ELK extension
cytoscape.use(elk)

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000"

async function fetchDiagram(center: string, radius: number): Promise<DiagramResponse> {
  const encodedCenter = encodeURIComponent(center)
  const res = await fetch(`${API_BASE}/diagram?center=${encodedCenter}&radius=${radius}`)
  if (!res.ok) {
    throw new Error("Failed to fetch diagram")
  }
  return res.json()
}

interface DiagramViewProps {
  iri: string
}

export function DiagramView({ iri }: DiagramViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const cyRef = React.useRef<cytoscape.Core | null>(null)
  
  console.log("DiagramView rendering for IRI:", iri)

  const [radius, setRadius] = React.useState<number>(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ["diagram", iri, radius],
    queryFn: () => fetchDiagram(iri, radius),
    enabled: !!iri,
  })

  // Initialize Cytoscape
  React.useEffect(() => {
    if (isLoading || !containerRef.current) return

    // Only initialize if not already initialized
    if (!cyRef.current) {
      console.log("Initializing Cytoscape", {
        width: containerRef.current.offsetWidth,
        height: containerRef.current.offsetHeight
      })

      cyRef.current = cytoscape({
        container: containerRef.current,
        wheelSensitivity: 0.2,
      })

      // Add ResizeObserver
      const ro = new ResizeObserver(() => {
        if (cyRef.current) {
          cyRef.current.resize()
          cyRef.current.fit()
        }
      })
      ro.observe(containerRef.current)

      cyRef.current.on("tap", "node", (evt) => {
        const node = evt.target
        const nodeIri = node.data("iri")
        if (nodeIri) {
          const params = new URLSearchParams(searchParams.toString())
          params.set("entity", nodeIri)
          router.push(`?${params.toString()}`)
        }
      })

      // Cleanup function for when the component unmounts
      // We attach it to the ref so we can clean it up later if needed, 
      // but actually the useEffect cleanup is better.
      // However, since we only want to init ONCE, we need to be careful.
    }
    
    // We don't destroy here because we want to persist the instance across theme changes
    // But we need to handle unmount.
    // Let's use a separate effect for cleanup or just check if container is still valid.

  }, [isLoading]) // Run when loading finishes

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
            "font-size": "10px",
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
        }
      ])
  }, [theme, isLoading]) // Update style when theme changes or after init

  // Update Data & Layout
  React.useEffect(() => {
    const cy = cyRef.current
    if (!cy || !data) return

    console.log("Updating Diagram Data", data)

    cy.elements().remove()

    const nodes = data.nodes.map(n => ({
      data: { 
        id: n.id, 
        iri: n.iri, 
        label: n.label, 
        isCenter: n.isCenter 
      }
    }))

    const edges = data.edges.map(e => {
      // @ts-ignore
      let label = e.label || e.property
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

    cy.add([...nodes, ...edges])

    const layoutName = edges.length === 0 ? "grid" : "cose"

    cy.layout({
      name: layoutName,
      animate: true,
      animationDuration: 500,
      fit: true,
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
    }).run()

  }, [data])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        Error loading diagram
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
      <div ref={containerRef} className="h-full w-full" />
      
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
            onClick={() => setRadius(1)}
          >
            1
          </button>
          <div className="w-px h-full bg-border" />
          <button
            className={cn("px-2 py-1 text-xs hover:bg-muted", radius === 2 && "bg-primary text-primary-foreground")}
            onClick={() => setRadius(2)}
          >
            2
          </button>
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => cyRef.current?.fit()}>
          <Maximize className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)}>
          <ZoomOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-background/90 p-3 rounded-md shadow-sm border text-xs space-y-2">
        <div className="font-semibold mb-1">Legend</div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-blue-600 bg-blue-100 rounded-sm" />
          <span>Selected Entity</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-gray-500 bg-white rounded-sm" />
          <span>Related Entity</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-px bg-gray-400" />
          <span>Relation</span>
        </div>
      </div>
    </div>
  )
}
