export interface ToolCatalogItem {
  backendMode: 'none' | 'api-ready';
  description: string;
  icon: 'braces' | 'brain';
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
    icon: 'braces',
    id: 'markdown-ast-studio',
    name: 'Markdown AST Studio',
    route: '/tools/markdown-ast-studio',
    status: 'Ready',
    tags: ['Editor', 'HTML preview', 'Document map'],
  },
  {
    backendMode: 'api-ready',
    description:
      'Practice refactoring intentionally messy JavaScript with hints, scoring, and skill tracking.',
    icon: 'brain',
    id: 'neatcode-academy',
    name: 'NEATCODE',
    route: '/tools/neatcode',
    status: 'Ready',
    tags: ['Refactoring', 'Account', 'Adaptive'],
  },
];
