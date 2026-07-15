export interface ToolCatalogItem {
  backendMode: 'none' | 'api-ready';
  description: string;
  id: string;
  name: string;
  route: string;
  status: string;
  tags: string[];
}

export const TOOL_CATALOG: ToolCatalogItem[] = [
  {
    backendMode: 'none',
    description: 'Write Markdown, preview generated HTML, and explore the document structure.',
    id: 'markdown-ast-studio',
    name: 'Markdown AST Studio',
    route: '/tools/markdown-ast-studio',
    status: 'Ready',
    tags: ['Editor', 'HTML preview', 'Document map'],
  },
];
