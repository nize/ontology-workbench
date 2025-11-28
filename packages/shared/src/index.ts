export interface TypeTreeNode {
  iri: string;
  label: string;
  hasChildren: boolean;
  childCount: number;
  primaryParent?: string | null;
  children: TypeTreeNode[];
}
