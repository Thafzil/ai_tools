import type { Root } from 'mdast';

export type MarkdownView = 'preview' | 'html' | 'ast';

export type HtmlAttributeValue = string | number | boolean;

export interface HtmlAttributeMap {
  [attribute: string]: HtmlAttributeValue;
}

export interface HtmlTextNode {
  kind: 'text';
  value: string;
}

export interface HtmlElementNode {
  kind: 'element';
  nodeId: string;
  tag: string;
  attributes?: HtmlAttributeMap;
  children?: HtmlNode[];
  selfClosing?: boolean;
}

export type HtmlNode = HtmlTextNode | HtmlElementNode;

export interface AstTreeNode {
  id: string;
  type: string;
  label: string;
  detail: string;
  depth: number;
  childCount: number;
}

export interface ElementTreeNode {
  id: string;
  nodeId?: string;
  label: string;
  detail: string;
  depth: number;
  childCount: number;
}

export interface HtmlSourceRow {
  id: string;
  nodeId: string;
  tag: string;
  openingTag: string;
  closingTag: string;
  detail: string;
  depth: number;
  childCount: number;
  selfClosing: boolean;
}

export interface MarkdownHeading {
  depth: number;
  text: string;
  slug: string;
}

export interface MarkdownStats {
  blocks: number;
  characters: number;
  codeBlocks: number;
  headings: MarkdownHeading[];
  images: number;
  links: number;
  lists: number;
  nodes: number;
  readTimeMinutes: number;
  tables: number;
  taskItems: number;
  words: number;
}

export interface MarkdownDocument {
  annotatedHtml: string;
  ast: Root;
  astTree: AstTreeNode[];
  elementTree: ElementTreeNode[];
  elements: HtmlNode[];
  html: string;
  sourceRows: HtmlSourceRow[];
  source: string;
  stats: MarkdownStats;
}

export interface MarkdownAstLike {
  type?: string;
  value?: unknown;
  children?: MarkdownAstLike[];
  position?: {
    start?: { line?: number; column?: number; offset?: number };
    end?: { line?: number; column?: number; offset?: number };
  };
  [key: string]: unknown;
}
