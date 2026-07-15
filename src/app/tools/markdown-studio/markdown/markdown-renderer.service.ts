import { Injectable } from '@angular/core';
import type { Root } from 'mdast';
import type {
  AstTreeNode,
  ElementTreeNode,
  HtmlAttributeMap,
  HtmlElementNode,
  HtmlNode,
  HtmlSourceRow,
  MarkdownAstLike,
} from './markdown.types';

interface RenderContext {
  headingCounts: Map<string, number>;
}

@Injectable({ providedIn: 'root' })
export class MarkdownRendererService {
  render(root: Root): HtmlNode[] {
    const context: RenderContext = { headingCounts: new Map() };
    const nodes = this.renderChildren(this.getChildren(root), context);
    this.assignElementIds(nodes);
    return nodes;
  }

  renderNode(node: MarkdownAstLike, context: RenderContext): HtmlNode[] {
    switch (node.type) {
      case 'root':
        return this.renderChildren(this.getChildren(node), context);
      case 'paragraph':
        return [this.element('p', {}, this.renderChildren(this.getChildren(node), context))];
      case 'heading':
        return [this.renderHeading(node, context)];
      case 'text':
        return [this.text(String(node.value ?? ''))];
      case 'emphasis':
        return [this.element('em', {}, this.renderChildren(this.getChildren(node), context))];
      case 'strong':
        return [this.element('strong', {}, this.renderChildren(this.getChildren(node), context))];
      case 'delete':
        return [this.element('del', {}, this.renderChildren(this.getChildren(node), context))];
      case 'inlineCode':
        return [
          this.element('code', { class: 'inline-code' }, [this.text(String(node.value ?? ''))]),
        ];
      case 'break':
        return [this.element('br', {}, [], true)];
      case 'thematicBreak':
        return [this.element('hr', {}, [], true)];
      case 'blockquote':
        return [
          this.element('blockquote', {}, this.renderChildren(this.getChildren(node), context)),
        ];
      case 'list':
        return [this.renderList(node, context)];
      case 'listItem':
        return [this.renderListItem(node, context)];
      case 'code':
        return [this.renderCodeBlock(node)];
      case 'html':
        return [this.renderRawHtml(node)];
      case 'link':
        return [this.renderLink(node, context)];
      case 'image':
        return [this.renderImage(node)];
      case 'table':
        return [this.renderTable(node, context)];
      case 'tableRow':
        return [this.element('tr', {}, this.renderChildren(this.getChildren(node), context))];
      case 'tableCell':
        return [this.element('td', {}, this.renderChildren(this.getChildren(node), context))];
      case 'footnoteReference':
        return [this.renderFootnoteReference(node)];
      case 'footnoteDefinition':
        return [this.renderFootnoteDefinition(node, context)];
      case 'definition':
        return [];
      default:
        return this.renderFallback(node, context);
    }
  }

  renderChildren(nodes: MarkdownAstLike[], context: RenderContext): HtmlNode[] {
    return nodes.flatMap((child) => this.renderNode(child, context));
  }

  toHtml(nodes: HtmlNode[], options: { annotated?: boolean } = {}): string {
    return nodes.map((node) => this.nodeToHtml(node, options)).join('\n');
  }

  buildDomNode(node: HtmlNode, documentRef: Document = document): HTMLElement | Text {
    if (node.kind === 'text') {
      return documentRef.createTextNode(node.value);
    }

    const element = documentRef.createElement(node.tag);
    Object.entries(node.attributes ?? {}).forEach(([name, value]) => {
      if (typeof value === 'boolean') {
        if (value) {
          element.setAttribute(name, '');
        }
        return;
      }

      element.setAttribute(name, String(value));
    });

    (node.children ?? []).forEach((child) => {
      element.appendChild(this.buildDomNode(child, documentRef));
    });

    return element;
  }

  flattenAst(root: Root): AstTreeNode[] {
    const rows: AstTreeNode[] = [];

    const walk = (node: MarkdownAstLike, depth: number, path: string): void => {
      const children = this.getChildren(node);
      rows.push({
        id: path,
        type: String(node.type ?? 'unknown'),
        label: this.getAstLabel(node),
        detail: this.getAstDetail(node),
        depth,
        childCount: children.length,
      });

      children.forEach((child, index) => walk(child, depth + 1, `${path}.${index}`));
    };

    walk(root as MarkdownAstLike, 0, '0');
    return rows;
  }

  flattenElements(nodes: HtmlNode[]): ElementTreeNode[] {
    const rows: ElementTreeNode[] = [];

    const walk = (node: HtmlNode, depth: number, path: string): void => {
      const children = node.kind === 'element' ? (node.children ?? []) : [];
      rows.push({
        id: path,
        nodeId: node.kind === 'element' ? node.nodeId : undefined,
        label: node.kind === 'text' ? '#text' : `<${node.tag}>`,
        detail:
          node.kind === 'text'
            ? this.truncate(node.value, 54)
            : this.formatAttributes(node.attributes),
        depth,
        childCount: children.length,
      });

      children.forEach((child, index) => walk(child, depth + 1, `${path}.${index}`));
    };

    nodes.forEach((node, index) => walk(node, 0, String(index)));
    return rows;
  }

  createHtmlSourceRows(nodes: HtmlNode[]): HtmlSourceRow[] {
    const rows: HtmlSourceRow[] = [];

    const walk = (node: HtmlNode, depth: number, path: string): void => {
      if (node.kind === 'text') {
        return;
      }

      rows.push({
        id: path,
        nodeId: node.nodeId,
        tag: node.tag,
        openingTag: this.createOpeningTag(node),
        closingTag: node.selfClosing ? '' : `</${node.tag}>`,
        detail: this.createElementPreview(node),
        depth,
        childCount: (node.children ?? []).filter((child) => child.kind === 'element').length,
        selfClosing: Boolean(node.selfClosing),
      });

      (node.children ?? []).forEach((child, index) => walk(child, depth + 1, `${path}.${index}`));
    };

    nodes.forEach((node, index) => walk(node, 0, String(index)));
    return rows;
  }

  private renderHeading(node: MarkdownAstLike, context: RenderContext): HtmlElementNode {
    const depth = this.getHeadingDepth(node);
    const textValue = this.collectPlainText(node);
    const slug = this.createUniqueSlug(textValue, context.headingCounts);
    return this.element(
      `h${depth}`,
      { id: slug },
      this.renderChildren(this.getChildren(node), context),
    );
  }

  private renderList(node: MarkdownAstLike, context: RenderContext): HtmlElementNode {
    const ordered = Boolean(node['ordered']);
    const hasTaskItem = this.getChildren(node).some(
      (child) => typeof child['checked'] === 'boolean',
    );
    const attributes: HtmlAttributeMap = {};

    if (typeof node['start'] === 'number' && node['start'] !== 1) {
      attributes['start'] = node['start'];
    }

    if (hasTaskItem) {
      attributes['class'] = 'contains-task-list';
    }

    return this.element(
      ordered ? 'ol' : 'ul',
      attributes,
      this.renderChildren(this.getChildren(node), context),
    );
  }

  private renderListItem(node: MarkdownAstLike, context: RenderContext): HtmlElementNode {
    const checked = node['checked'];
    const sourceChildren = this.getChildren(node);
    const attributes: HtmlAttributeMap =
      typeof checked === 'boolean' ? { class: 'task-list-item' } : {};

    if (typeof checked !== 'boolean') {
      return this.element('li', attributes, this.renderChildren(sourceChildren, context));
    }

    const checkbox = this.element(
      'input',
      {
        checked,
        disabled: true,
        type: 'checkbox',
        'aria-label': checked ? 'Completed task' : 'Incomplete task',
      },
      [],
      true,
    );
    const [firstChild, ...rest] = sourceChildren;
    const children: HtmlNode[] = [checkbox];

    if (firstChild?.type === 'paragraph') {
      children.push(...this.renderChildren(this.getChildren(firstChild), context));
      children.push(...this.renderChildren(rest, context));
    } else {
      children.push(...this.renderChildren(sourceChildren, context));
    }

    return this.element('li', attributes, children);
  }

  private renderCodeBlock(node: MarkdownAstLike): HtmlElementNode {
    const language = typeof node['lang'] === 'string' && node['lang'] ? node['lang'] : 'text';
    return this.element('pre', { class: 'code-block', 'data-language': language }, [
      this.element('code', { class: `language-${this.safeClassName(language)}` }, [
        this.text(String(node.value ?? '')),
      ]),
    ]);
  }

  private renderRawHtml(node: MarkdownAstLike): HtmlElementNode {
    return this.element('pre', { class: 'raw-html-block', 'data-node': 'html' }, [
      this.element('code', {}, [this.text(String(node.value ?? ''))]),
    ]);
  }

  private renderLink(node: MarkdownAstLike, context: RenderContext): HtmlElementNode {
    const href = this.sanitizeUrl(String(node['url'] ?? ''));
    const attributes: HtmlAttributeMap = { href };
    const title = node['title'];

    if (typeof title === 'string' && title) {
      attributes['title'] = title;
    }

    if (/^https?:\/\//i.test(href)) {
      attributes['target'] = '_blank';
      attributes['rel'] = 'noreferrer noopener';
    }

    return this.element('a', attributes, this.renderChildren(this.getChildren(node), context));
  }

  private renderImage(node: MarkdownAstLike): HtmlElementNode {
    const src = this.sanitizeUrl(String(node['url'] ?? ''));
    const attributes: HtmlAttributeMap = {
      alt: String(node['alt'] ?? ''),
      decoding: 'async',
      loading: 'lazy',
      src,
    };
    const title = node['title'];

    if (typeof title === 'string' && title) {
      attributes['title'] = title;
    }

    return this.element('img', attributes, [], true);
  }

  private renderTable(node: MarkdownAstLike, context: RenderContext): HtmlElementNode {
    const rows = this.getChildren(node);
    const align = Array.isArray(node['align']) ? node['align'] : [];
    const [headerRow, ...bodyRows] = rows;
    const headerCells = this.getChildren(headerRow).map((cell, index) => {
      return this.element(
        'th',
        this.tableCellAttributes(align[index]),
        this.renderChildren(this.getChildren(cell), context),
      );
    });
    const body = bodyRows.map((row) => {
      const cells = this.getChildren(row).map((cell, index) => {
        return this.element(
          'td',
          this.tableCellAttributes(align[index]),
          this.renderChildren(this.getChildren(cell), context),
        );
      });
      return this.element('tr', {}, cells);
    });

    return this.element('div', { class: 'table-shell' }, [
      this.element('table', {}, [
        this.element('thead', {}, [this.element('tr', {}, headerCells)]),
        this.element('tbody', {}, body),
      ]),
    ]);
  }

  private renderFootnoteReference(node: MarkdownAstLike): HtmlElementNode {
    const identifier = String(node['identifier'] ?? '');
    return this.element('sup', { id: `fnref-${this.safeClassName(identifier)}` }, [
      this.element('a', { href: `#fn-${this.safeClassName(identifier)}` }, [this.text(identifier)]),
    ]);
  }

  private renderFootnoteDefinition(node: MarkdownAstLike, context: RenderContext): HtmlElementNode {
    const identifier = String(node['identifier'] ?? '');
    return this.element(
      'aside',
      { class: 'footnote', id: `fn-${this.safeClassName(identifier)}` },
      [
        this.element('span', { class: 'footnote-label' }, [this.text(identifier)]),
        ...this.renderChildren(this.getChildren(node), context),
      ],
    );
  }

  private renderFallback(node: MarkdownAstLike, context: RenderContext): HtmlNode[] {
    if (typeof node.value === 'string') {
      return [this.text(node.value)];
    }

    return this.renderChildren(this.getChildren(node), context);
  }

  private assignElementIds(nodes: HtmlNode[]): void {
    let index = 0;

    const walk = (node: HtmlNode): void => {
      if (node.kind === 'text') {
        return;
      }

      node.nodeId = `el-${index}`;
      index += 1;
      (node.children ?? []).forEach(walk);
    };

    nodes.forEach(walk);
  }

  private nodeToHtml(node: HtmlNode, options: { annotated?: boolean }): string {
    if (node.kind === 'text') {
      return this.escapeHtml(node.value);
    }

    const attributes = this.attributesToHtml(this.getOutputAttributes(node, options.annotated));
    const opening = attributes ? `<${node.tag} ${attributes}>` : `<${node.tag}>`;

    if (node.selfClosing) {
      return opening;
    }

    return `${opening}${(node.children ?? []).map((child) => this.nodeToHtml(child, options)).join('')}</${node.tag}>`;
  }

  private getOutputAttributes(
    node: HtmlElementNode,
    annotated: boolean | undefined,
  ): HtmlAttributeMap {
    if (!annotated) {
      return node.attributes ?? {};
    }

    return {
      ...(node.attributes ?? {}),
      'data-preview-id': node.nodeId,
    };
  }

  private attributesToHtml(attributes: HtmlAttributeMap): string {
    return Object.entries(attributes)
      .filter(([, value]) => value !== false && value !== null && value !== undefined)
      .map(([name, value]) => {
        if (value === true) {
          return name;
        }

        return `${name}="${this.escapeAttribute(String(value))}"`;
      })
      .join(' ');
  }

  private element(
    tag: string,
    attributes: HtmlAttributeMap = {},
    children: HtmlNode[] = [],
    selfClosing = false,
  ): HtmlElementNode {
    return { kind: 'element', nodeId: '', tag, attributes, children, selfClosing };
  }

  private text(value: string): HtmlNode {
    return { kind: 'text', value };
  }

  private tableCellAttributes(alignment: unknown): HtmlAttributeMap {
    if (alignment === 'left' || alignment === 'center' || alignment === 'right') {
      return { style: `text-align: ${alignment}` };
    }

    return {};
  }

  private getChildren(node: MarkdownAstLike | Root | undefined): MarkdownAstLike[] {
    if (!node || !Array.isArray((node as MarkdownAstLike).children)) {
      return [];
    }

    return (node as MarkdownAstLike).children ?? [];
  }

  private getHeadingDepth(node: MarkdownAstLike): number {
    const depth = Number(node['depth']);
    return Number.isInteger(depth) && depth >= 1 && depth <= 6 ? depth : 2;
  }

  private getAstLabel(node: MarkdownAstLike): string {
    if (node.type === 'heading') {
      return `heading ${node['depth'] ?? ''}`.trim();
    }

    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      return `${node.type}: ${this.truncate(String(node.value ?? ''), 44)}`;
    }

    if (node.type === 'link' || node.type === 'image') {
      return `${node.type}: ${this.truncate(String(node['url'] ?? ''), 44)}`;
    }

    return String(node.type ?? 'unknown');
  }

  private getAstDetail(node: MarkdownAstLike): string {
    const position = node.position?.start?.line ? `line ${node.position.start.line}` : '';
    const childCount = this.getChildren(node).length;
    const childLabel = childCount === 1 ? '1 child' : `${childCount} children`;

    return [position, childCount ? childLabel : 'leaf'].filter(Boolean).join(' · ');
  }

  private collectPlainText(node: MarkdownAstLike): string {
    if (typeof node.value === 'string') {
      return node.value;
    }

    return this.getChildren(node)
      .map((child) => this.collectPlainText(child))
      .join(' ');
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

  private sanitizeUrl(value: string): string {
    const trimmed = value.trim();

    if (!trimmed) {
      return '';
    }

    if (/^(#|\/|\.\/|\.\.\/)/.test(trimmed)) {
      return trimmed;
    }

    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) {
      return trimmed;
    }

    return '#';
  }

  private safeClassName(value: string): string {
    return this.slugify(value) || 'text';
  }

  private formatAttributes(attributes?: HtmlAttributeMap): string {
    const entries = Object.entries(attributes ?? {});

    if (!entries.length) {
      return '';
    }

    return entries
      .map(([key, value]) => (value === true ? key : `${key}=${this.truncate(String(value), 28)}`))
      .join(' ');
  }

  private createOpeningTag(node: HtmlElementNode): string {
    const attributes = this.attributesToHtml(node.attributes ?? {});
    return attributes ? `<${node.tag} ${attributes}>` : `<${node.tag}>`;
  }

  private createElementPreview(node: HtmlElementNode): string {
    const text = this.collectElementText(node).replace(/\s+/g, ' ').trim();

    if (text) {
      return this.truncate(text, 56);
    }

    return this.formatAttributes(node.attributes);
  }

  private collectElementText(node: HtmlNode): string {
    if (node.kind === 'text') {
      return node.value;
    }

    return (node.children ?? []).map((child) => this.collectElementText(child)).join(' ');
  }

  private truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value).replace(/"/g, '&quot;');
  }
}
