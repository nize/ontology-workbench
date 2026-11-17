"use client"

import * as React from "react"
import { ChevronRight, ChevronDown, Search, Diamond } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Virtuoso } from "react-virtuoso"
import { TypeTreeNode } from "@acme/shared"
import { useQueryClient } from "@tanstack/react-query"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
import { useIndividuals } from "@/hooks/use-individuals"
import { useVocabulary } from "@/hooks/use-vocabulary"
import { readRadius, updateUrlParams } from "@/lib/url-state"

// Individuals listed under an expanded class, a page at a time.
const TREE_INDIVIDUALS_PAGE_SIZE = 20

interface FlattenedNode extends TypeTreeNode {
  rowKind: "class"
  depth: number
  isExpanded: boolean
  areChildrenLoaded?: boolean
}

type TreeRow =
  | FlattenedNode
  | { rowKind: "individual"; iri: string; label: string; depth: number }
  | { rowKind: "loading"; key: string; depth: number }
  | { rowKind: "more"; classIri: string; depth: number; shown: number; total: number }

interface LoadedIndividuals {
  items: { iri: string; label: string }[]
  total: number
  isFetching: boolean
}

function isExpandable(node: TypeTreeNode) {
  return node.hasChildren || (node.individualCount ?? 0) > 0
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
  const [loadedIndividuals, setLoadedIndividuals] = React.useState<Record<string, LoadedIndividuals>>({})
  // How many pages of individuals each class should show; grows with "Show more".
  const [requestedIndividualPages, setRequestedIndividualPages] = React.useState<Record<string, number>>({})

  const handleIndividualsLoaded = React.useCallback((classIri: string, loaded: LoadedIndividuals) => {
    setLoadedIndividuals((prev) => {
      const current = prev[classIri]
      if (
        current
        && current.isFetching === loaded.isFetching
        && current.total === loaded.total
        && current.items === loaded.items
      ) {
        return prev
      }
      return { ...prev, [classIri]: loaded }
    })
  }, [])

  const showMoreIndividuals = (classIri: string) => {
    setRequestedIndividualPages((prev) => ({ ...prev, [classIri]: (prev[classIri] ?? 1) + 1 }))
  }
  
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

  const { rows: flattenTree, individualClasses } = React.useMemo(() => {
    const rows: TreeRow[] = []
    const classesWithIndividuals = new Set<string>()
    if (!rootNodes) return { rows, individualClasses: [] as string[] }

    const needle = filter.toLowerCase()
    const matches = (label: string) => !filter || label.toLowerCase().includes(needle)

    const traverse = (nodes: TypeTreeNode[], depth: number) => {
      for (const node of nodes) {
        const isExpanded = expandedNodes.has(node.iri)
        const loaded = loadedChildren[node.iri]
        const children = loaded || node.children || []
        const areChildrenLoaded = !!loaded || (!!node.children && node.children.length > 0)

        // The filter applies to what is loaded; expanded branches stay walkable.
        if (matches(node.label)) {
          rows.push({ ...node, rowKind: "class", depth, isExpanded, areChildrenLoaded })
        }

        if (!isExpanded) continue

        // Subclasses first...
        if (children.length > 0) {
          traverse(children, depth + 1)
        } else if (node.hasChildren && !areChildrenLoaded) {
          rows.push({ rowKind: "loading", key: `${node.iri}|children`, depth: depth + 1 })
        }

        // ...then the class's own individuals, paged.
        const individualCount = node.individualCount ?? 0
        if (individualCount === 0) continue
        classesWithIndividuals.add(node.iri)

        const individuals = loadedIndividuals[node.iri]
        for (const individual of individuals?.items ?? []) {
          if (matches(individual.label)) {
            rows.push({ rowKind: "individual", iri: individual.iri, label: individual.label, depth: depth + 1 })
          }
        }
        const shown = individuals?.items.length ?? 0
        const total = individuals?.total ?? individualCount
        if (!individuals || individuals.isFetching) {
          rows.push({ rowKind: "loading", key: `${node.iri}|individuals`, depth: depth + 1 })
        } else if (shown < total) {
          rows.push({ rowKind: "more", classIri: node.iri, depth: depth + 1, shown, total })
        }
      }
    }

    traverse(rootNodes, 0)
    return { rows, individualClasses: [...classesWithIndividuals] }
  }, [rootNodes, expandedNodes, loadedChildren, loadedIndividuals, filter])

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
      
      {individualClasses.map((classIri) => (
        <IndividualsFetcher
          key={classIri}
          classIri={classIri}
          workspace={workspace}
          requestedPages={requestedIndividualPages[classIri] ?? 1}
          onLoaded={handleIndividualsLoaded}
        />
      ))}

      <div className="flex-1">
        {flattenTree.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {filter ? "No types match this filter." : "No types available in this workspace."}
          </div>
        ) : (
        <Virtuoso
          style={{ height: '100%' }}
          data={flattenTree}
          computeItemKey={(index, row) => rowKey(row, index)}
          itemContent={(index, row) => {
            switch (row.rowKind) {
              case "class":
                return (
                  <NodeItem
                    node={row}
                    onToggle={() => toggleExpand(row)}
                    onClick={() => handleNodeClick(row.iri)}
                    onHover={() => handleNodeHover(row.iri)}
                    onLoadChildren={(children) => setLoadedChildren(prev => {
                      if (prev[row.iri]) return prev
                      return { ...prev, [row.iri]: children }
                    })}
                  />
                )
              case "individual":
                return (
                  <IndividualItem
                    row={row}
                    onClick={() => handleNodeClick(row.iri)}
                    onHover={() => handleNodeHover(row.iri)}
                  />
                )
              case "more":
                return (
                  <button
                    type="button"
                    className="w-full truncate whitespace-nowrap text-left py-1 px-2 text-xs text-primary hover:underline"
                    style={{ paddingLeft: `${row.depth * 1.5 + 1.75}rem` }}
                    onClick={() => showMoreIndividuals(row.classIri)}
                  >
                    Show {Math.min(TREE_INDIVIDUALS_PAGE_SIZE, row.total - row.shown)} more
                    <span className="text-muted-foreground"> ({row.shown} of {row.total} individuals)</span>
                  </button>
                )
              case "loading":
                return (
                  <div
                    className="py-1 px-2 text-sm text-muted-foreground opacity-50 cursor-wait"
                    style={{ paddingLeft: `${row.depth * 1.5 + 1.75}rem` }}
                  >
                    Loading...
                  </div>
                )
            }
          }}
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
  const { t } = useVocabulary()
  // If expanded and no children loaded yet, fetch them
  // We use a separate component to handle the query hook
  
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div 
          className="flex items-center py-1 px-2 hover:bg-accent/50 cursor-pointer text-sm select-none"
          style={{ paddingLeft: `${node.depth * 1.5 + 0.5}rem` }}
          onClick={onClick}
          onMouseEnter={onHover}
        >
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-4 w-4 p-0 mr-1 hover:bg-transparent"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {isExpandable(node) ? (
              node.isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
            ) : (
              <span className="w-3 h-3" />
            )}
          </Button>
          
          <span className="truncate flex-1 flex items-center gap-2">
            {node.label}
            {node.childCount > 0 && (
               <span className="text-xs text-muted-foreground" title={t("subclasses")}>({node.childCount})</span>
            )}
            {(node.individualCount ?? 0) > 0 && (
               <span
                 className="inline-flex items-center gap-0.5 text-xs text-violet-600 dark:text-violet-400"
                 title={t("individuals")}
               >
                 <Diamond className="h-2.5 w-2.5" />
                 {node.individualCount}
               </span>
            )}
          </span>

          {node.isExpanded && node.hasChildren && !node.areChildrenLoaded && (
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

function rowKey(row: TreeRow, index: number): string {
  switch (row.rowKind) {
    case "class":
      return `c|${index}|${row.iri}`
    case "individual":
      return `i|${index}|${row.iri}`
    case "loading":
      return `l|${row.key}`
    case "more":
      return `m|${row.classIri}`
  }
}

function IndividualItem({
  row,
  onClick,
  onHover
}: {
  row: Extract<TreeRow, { rowKind: "individual" }>
  onClick: () => void
  onHover: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className="flex items-center py-1 px-2 hover:bg-accent/50 cursor-pointer text-sm select-none"
          style={{ paddingLeft: `${row.depth * 1.5 + 0.5}rem` }}
          onClick={onClick}
          onMouseEnter={onHover}
          title={row.iri}
        >
          <span className="w-4 h-4 mr-1 flex items-center justify-center">
            <Diamond className="h-3 w-3 text-violet-600 dark:text-violet-400" />
          </span>
          <span className="truncate flex-1 italic">{row.label}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onClick}>Show Details</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Lives outside the virtualized list so loading survives scrolling.
function IndividualsFetcher({
  classIri,
  workspace,
  requestedPages,
  onLoaded
}: {
  classIri: string
  workspace?: string
  requestedPages: number
  onLoaded: (classIri: string, loaded: LoadedIndividuals) => void
}) {
  const { data, hasNextPage, isFetching, isFetchingNextPage, isError, fetchNextPage } =
    useIndividuals(classIri, TREE_INDIVIDUALS_PAGE_SIZE, workspace)

  const loadedPages = data?.pages.length ?? 0
  React.useEffect(() => {
    if (loadedPages > 0 && loadedPages < requestedPages && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [loadedPages, requestedPages, hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = React.useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])
  // On error, settle on what loaded so the row doesn't spin forever (the API layer toasts).
  const total = isError ? items.length : data?.pages[0]?.total ?? 0
  const pending = !isError && (!data || isFetching || (loadedPages < requestedPages && !!hasNextPage))

  React.useEffect(() => {
    if (data || isFetching || isError) {
      onLoaded(classIri, { items, total, isFetching: pending })
    }
  }, [classIri, data, items, total, pending, isFetching, isError, onLoaded])

  return null
}
