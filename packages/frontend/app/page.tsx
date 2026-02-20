import { DiagramView } from "@/components/diagram-view"

export default function Home({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const center =
    typeof searchParams.center === "string"
      ? searchParams.center
      : typeof searchParams.entity === "string"
        ? searchParams.entity
        : undefined
  const pane = searchParams.pane === "search" ? "search" : "diagram"
  const workspace = typeof searchParams.workspace === "string" ? searchParams.workspace : undefined

  if (pane === "diagram" && center) {
    return <DiagramView iri={center} workspace={workspace} />
  }

  if (pane === "search") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Search Pane</h1>
        <p className="text-muted-foreground max-w-md">
          Use the global search input in the header to browse results.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
      <h1 className="text-4xl font-bold tracking-tight">Welcome to Ontology Workbench</h1>
      <p className="text-muted-foreground max-w-md">
        Select a type from the navigation or search for an entity to get started.
      </p>
    </div>
  );
}
