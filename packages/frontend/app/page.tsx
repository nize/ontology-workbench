import { DiagramView } from "@/components/diagram-view"

export default function Home({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const entity = typeof searchParams.entity === 'string' ? searchParams.entity : undefined

  if (entity) {
    return <DiagramView iri={entity} />
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
