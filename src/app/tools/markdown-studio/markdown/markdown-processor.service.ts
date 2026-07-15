import { Injectable } from '@angular/core';
import type { Root } from 'mdast';
import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { MarkdownRendererService } from './markdown-renderer.service';
import type {
  MarkdownAstLike,
  MarkdownDocument,
  MarkdownHeading,
  MarkdownStats,
} from './markdown.types';

@Injectable({ providedIn: 'root' })
export class MarkdownProcessorService {
  private readonly parser = unified().use(remarkParse).use(remarkGfm);

  constructor(private readonly renderer: MarkdownRendererService) {}

  process(source: string): MarkdownDocument {
    const ast = this.parser.parse(source) as Root;
    const elements = this.renderer.render(ast);

    return {
      annotatedHtml: this.renderer.toHtml(elements, { annotated: true }),
      ast,
      astTree: this.renderer.flattenAst(ast),
      elementTree: this.renderer.flattenElements(elements),
      elements,
      html: this.renderer.toHtml(elements),
      sourceRows: this.renderer.createHtmlSourceRows(elements),
      source,
      stats: this.createStats(ast, source),
    };
  }

  private createStats(root: Root, source: string): MarkdownStats {
    const headings: MarkdownHeading[] = [];
    const plainText: string[] = [];
    const headingCounts = new Map<string, number>();
    const stats: MarkdownStats = {
      blocks: root.children.length,
      characters: source.length,
      codeBlocks: 0,
      headings,
      images: 0,
      links: 0,
      lists: 0,
      nodes: 0,
      readTimeMinutes: 1,
      tables: 0,
      taskItems: 0,
      words: 0,
    };

    const visit = (node: MarkdownAstLike): void => {
      stats.nodes += 1;

      switch (node.type) {
        case 'heading': {
          const text = this.collectPlainText(node);
          headings.push({
            depth: this.getHeadingDepth(node),
            slug: this.createUniqueSlug(text, headingCounts),
            text,
          });
          break;
        }
        case 'text':
        case 'inlineCode':
        case 'code':
          if (typeof node.value === 'string') {
            plainText.push(node.value);
          }
          break;
        case 'link':
          stats.links += 1;
          break;
        case 'image':
          stats.images += 1;
          break;
        case 'list':
          stats.lists += 1;
          break;
        case 'listItem':
          if (typeof node['checked'] === 'boolean') {
            stats.taskItems += 1;
          }
          break;
        case 'table':
          stats.tables += 1;
          break;
      }

      if (node.type === 'code') {
        stats.codeBlocks += 1;
      }

      this.getChildren(node).forEach(visit);
    };

    visit(root as MarkdownAstLike);

    const words = plainText.join(' ').match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];
    stats.words = words.length;
    stats.readTimeMinutes = Math.max(1, Math.ceil(stats.words / 220));

    return stats;
  }

  private collectPlainText(node: MarkdownAstLike): string {
    if (typeof node.value === 'string') {
      return node.value;
    }

    return this.getChildren(node)
      .map((child) => this.collectPlainText(child))
      .join(' ')
      .trim();
  }

  private getChildren(node: MarkdownAstLike): MarkdownAstLike[] {
    return Array.isArray(node.children) ? node.children : [];
  }

  private getHeadingDepth(node: MarkdownAstLike): number {
    const depth = Number(node['depth']);
    return Number.isInteger(depth) && depth >= 1 && depth <= 6 ? depth : 2;
  }

  private createUniqueSlug(value: string, seen: Map<string, number>): string {
    const base = this.slugify(value) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
