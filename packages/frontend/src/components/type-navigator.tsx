"use client"

import * as React from "react"
import { ChevronRight, ChevronDown, Search, Folder, File, MoreHorizontal } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Virtuoso } from "react-virtuoso"
import { TypeTreeNode } from "@acme/shared"
import { useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useTypeTree } from "@/hooks/use-type-tree"
import { diagramQueryKey, fetchDiagram } from "@/hooks/use-diagram"
import { entityQueryKey, fetchEntity } from "@/hooks/use-entity"
import { readRadius, updateUrlParams } from "@/lib/url-state"

interface FlattenedNode extends TypeTreeNode {
  depth: number
  isExpanded: boolean
  isLoading?: boolean
  areChildrenLoaded?: boolean
}

export function TypeNavigator({ workspace }: { workspace?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const radius = readRadius(searchParams)
  const [filter, setFilter] = React.useState("")
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(new Set())
  
  // We fetch the root level initially
  const { data: rootNodes, isLoading, error, refetch } = useTypeTree(undefined, 1, workspace)
  
  // We need a way to fetch children on demand. 
  // Since useTypeTree is a hook, we can't call it conditionally inside a loop or callback easily.
  // Instead, we'll maintain a map of loaded children.
  const [loadedChildren, setLoadedChildren] = React.useState<Record<string, TypeTreeNode[]>>({})
  
  // This is a bit of a hack to trigger fetches. In a real app, we might use useQueries or a more sophisticated cache manager.
  // For now, we'll just use a separate component to fetch children when expanded.
  
  const toggleExpand = (node: TypeTreeNode) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(node.iri)) {
      newExpanded.delete(node.iri)
    } else {
      newExpanded.add(node.iri)
    }
    setExpandedNodes(newExpanded)
  }

  const flattenTree = React.useMemo(() => {
    if (!rootNodes) return []

    const result: FlattenedNode[] = []
    
    const traverse = (nodes: TypeTreeNode[], depth: number) => {
      for (const node of nodes) {
        // Apply filter
        if (filter && !node.label.toLowerCase().includes(filter.toLowerCase())) {
           // If node doesn't match, check if any children match (if we have them)
           // This is tricky with lazy loading. For now, simple filter on visible nodes.
           // Better: Filter only applies to what's visible/loaded.
        }

        const isExpanded = expandedNodes.has(node.iri)
        const loaded = loadedChildren[node.iri]
        const children = loaded || node.children || []
        const areChildrenLoaded = !!loaded || (!!node.children && node.children.length > 0)
        
        // If filtered, we might want to show even if not matching if a child matches?
        // For simple client-side filter on loaded tree:
        const matches = node.label.toLowerCase().includes(filter.toLowerCase())
        
        if (matches || !filter) {
             result.push({ ...node, depth, isExpanded, areChildrenLoaded })
        }

        if (isExpanded) {
          if (children.length > 0) {
            traverse(children, depth + 1)
          } else if (node.hasChildren && !areChildrenLoaded) {
             // Placeholder for loading
             result.push({ ...node, iri: `${node.iri}-loading`, label: "Loading...", depth: depth + 1, isExpanded: false, isLoading: true, hasChildren: false, childCount: 0, children: [] })
          }
        }
      }
    }

    traverse(rootNodes, 0)
    return result
  }, [rootNodes, expandedNodes, loadedChildren, filter])

  const handleNodeClick = (iri: string) => {
    const params = updateUrlParams(searchParams, {
      center: iri,
      entity: iri,
      pane: "diagram",
      details: "on"
    })
    router.push(`?${params.toString()}`)
  }

  const handleNodeHover = (iri: string) => {
    queryClient.prefetchQuery({
      queryKey: entityQueryKey(iri, workspace),
      queryFn: () => fetchEntity(iri, workspace)
    })
    queryClient.prefetchQuery({
      queryKey: diagramQueryKey(iri, radius, workspace),
      queryFn: () => fetchDiagram(iri, radius, workspace)
    })
  }

  if (error) {
    return (
      <div className="p-4 text-destructive text-sm space-y-2">
        <div>Error loading types.</div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Filter types..." 
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 h-8"
          />
        </div>
      </div>
      
      <div className="flex-1">
        {flattenTree.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {filter ? "No types match this filter." : "No types available in this workspace."}
          </div>
        ) : (
        <Virtuoso
          style={{ height: '100%' }}
          data={flattenTree}
          itemContent={(index, node) => (
            <NodeItem 
              node={node} 
              onToggle={() => toggleExpand(node)}
              onClick={() => handleNodeClick(node.iri)}
              onHover={() => handleNodeHover(node.iri)}
              onLoadChildren={(children) => setLoadedChildren(prev => {
                if (prev[node.iri]) return prev
                return { ...prev, [node.iri]: children }
              })}
            />
          )}
        />
        )}
      </div>
    </div>
  )
}

function NodeItem({ 
  node, 
  onToggle, 
  onClick,
  onHover,
  onLoadChildren
}: { 
  node: FlattenedNode; 
  onToggle: () => void; 
  onClick: () => void;
  onHover: () => void;
  onLoadChildren: (children: TypeTreeNode[]) => void;
}) {
  // If expanded and no children loaded yet, fetch them
  // We use a separate component to handle the query hook
  
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div 
          className={cn(
            "flex items-center py-1 px-2 hover:bg-accent/50 cursor-pointer text-sm select-none",
            node.isLoading && "opacity-50 cursor-wait"
          )}
          style={{ paddingLeft: `${node.depth * 1.5 + 0.5}rem` }}
          onClick={onClick}
          onMouseEnter={onHover}
        >
          {node.isLoading ? (
             <span className="w-4 h-4 mr-1" />
          ) : (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-4 w-4 p-0 mr-1 hover:bg-transparent"
              onClick={(e) => {
                e.stopPropagation()
                onToggle()
              }}
            >
              {node.hasChildren ? (
                node.isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
              ) : (
                <span className="w-3 h-3" />
              )}
            </Button>
          )}
          
          <span className="truncate flex-1 flex items-center gap-2">
            {node.label}
            {node.childCount > 0 && (
               <span className="text-xs text-muted-foreground">({node.childCount})</span>
            )}
          </span>

          {node.isExpanded && node.hasChildren && !node.isLoading && !node.areChildrenLoaded && (
             <ChildrenFetcher iri={node.iri} onLoaded={onLoadChildren} />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onClick}>
          Show Details
        </ContextMenuItem>
        <ContextMenuItem onClick={() => {
           // Open in center logic (currently same as details, but could be diagram)
           onClick()
        }}>
          Open in Center
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function ChildrenFetcher({ iri, onLoaded }: { iri: string, onLoaded: (children: TypeTreeNode[]) => void }) {
  const searchParams = useSearchParams()
  const workspace = searchParams.get("workspace") ?? undefined
  const { data } = useTypeTree(iri, 1, workspace)
  
  React.useEffect(() => {
    if (data) {
      onLoaded(data)
    }
  }, [data, onLoaded])
  
  return null
}
