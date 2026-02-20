"use client"

import * as React from "react"
import { ImperativePanelHandle } from "react-resizable-panels"
import { Search, PanelLeft, PanelRight } from "lucide-react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { EntityDetailsPanel } from "@/components/entity-details"
import { TypeNavigator } from "@/components/type-navigator"
import { GlobalSearch } from "@/components/global-search"
import { DevTelemetry } from "@/components/dev-telemetry"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { readCenter, readWorkspace, updateUrlParams } from "@/lib/url-state"

interface ShellProps {
  children: React.ReactNode
  nav?: React.ReactNode
  details?: React.ReactNode
}

export function Shell({ children, nav, details }: ShellProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)")
  const isLargeDesktop = useMediaQuery("(min-width: 1280px)")
  
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const entityIri = readCenter(searchParams)
  const workspace = readWorkspace(searchParams)

  const leftPanelRef = React.useRef<ImperativePanelHandle>(null)
  const rightPanelRef = React.useRef<ImperativePanelHandle>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const [isLeftCollapsed, setIsLeftCollapsed] = React.useState(false)
  const [isRightCollapsed, setIsRightCollapsed] = React.useState(true)

  const syncDetailsInUrl = React.useCallback(
    (collapsed: boolean) => {
      const params = updateUrlParams(searchParams, { details: collapsed ? "off" : "on" })
      router.replace(`${pathname}?${params.toString()}`)
    },
    [pathname, router, searchParams]
  )

  // Initialize state from URL and props
  React.useEffect(() => {
    const detailsParam = searchParams.get("details")
    if (detailsParam === "on") {
      setIsRightCollapsed(false)
      rightPanelRef.current?.expand()
    } else if (detailsParam === "off") {
      setIsRightCollapsed(true)
      rightPanelRef.current?.collapse()
    } else {
      // Default behavior based on screen size
      if (isLargeDesktop) {
        setIsRightCollapsed(false)
        rightPanelRef.current?.expand()
      } else {
        setIsRightCollapsed(true)
        rightPanelRef.current?.collapse()
      }
    }
  }, [searchParams, isLargeDesktop])

  const toggleLeft = () => {
    const panel = leftPanelRef.current
    if (panel) {
      if (isLeftCollapsed) panel.expand()
      else panel.collapse()
      setIsLeftCollapsed(!isLeftCollapsed)
    }
  }

  const toggleRight = () => {
    const panel = rightPanelRef.current
    if (panel) {
      const newCollapsed = !isRightCollapsed
      if (newCollapsed) panel.collapse()
      else panel.expand()
      setIsRightCollapsed(newCollapsed)
      syncDetailsInUrl(newCollapsed)
    }
  }

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === "[") {
        toggleLeft()
      } else if (e.key === "]") {
        toggleRight()
      } else if (e.key === "/" || (e.metaKey && e.key === "k") || (e.ctrlKey && e.key === "k")) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isLeftCollapsed, isRightCollapsed, searchParams, pathname, router])

  if (!isDesktop) {
    return (
      <div className="flex flex-col h-screen bg-background text-foreground">
        <header className="flex items-center justify-between p-4 border-b">
          <div className="font-bold">Ontology Workbench</div>
          <div className="flex items-center gap-2">
             <Button variant="ghost" size="icon" onClick={() => {}}>
               <Search className="h-5 w-5" />
             </Button>
             <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4">
          {children}
        </main>
        {/* Mobile nav/details handling would go here, e.g. tabs or drawers */}
      </div>
    )
  }

  return (
    <div className="h-screen w-full bg-background text-foreground overflow-hidden flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b h-14 shrink-0">
        <div className="flex items-center gap-4">
          <div className="font-bold text-lg">Ontology Workbench</div>
          <Button variant="ghost" size="icon" onClick={toggleLeft} className={cn(isLeftCollapsed && "text-muted-foreground")}>
            <PanelLeft className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="flex-1 max-w-xl mx-4">
          <GlobalSearch ref={searchInputRef} />
        </div>

        <div className="flex items-center gap-2">
          <DevTelemetry />
          <Button variant="ghost" size="icon" onClick={toggleRight} className={cn(isRightCollapsed && "text-muted-foreground")}>
            <PanelRight className="h-5 w-5" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" autoSaveId="ontology-workbench-layout">
          <ResizablePanel 
            ref={leftPanelRef}
            defaultSize={20} 
            minSize={15} 
            maxSize={30} 
            collapsible={true}
            onCollapse={() => setIsLeftCollapsed(true)}
            onExpand={() => setIsLeftCollapsed(false)}
            className={cn("bg-muted/10", isLeftCollapsed && "min-w-[50px] transition-all duration-300 ease-in-out")}
          >
            <div className="h-full overflow-hidden">
              {nav || <TypeNavigator workspace={workspace} />}
            </div>
          </ResizablePanel>
          
          <ResizableHandle withHandle />
          
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full p-4 overflow-auto">
              {children}
            </div>
          </ResizablePanel>
          
          <ResizableHandle withHandle />
          
          <ResizablePanel 
            ref={rightPanelRef}
            defaultSize={30} 
            minSize={20} 
            maxSize={40} 
            collapsible={true}
            onCollapse={() => {
              setIsRightCollapsed(true)
              syncDetailsInUrl(true)
            }}
            onExpand={() => {
              setIsRightCollapsed(false)
              syncDetailsInUrl(false)
            }}
            className="bg-muted/10"
          >
             <div className="h-full overflow-hidden">
              {details || (entityIri ? <EntityDetailsPanel iri={entityIri} workspace={workspace} /> : <div className="p-4 text-muted-foreground text-sm">Entity Details</div>)}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
