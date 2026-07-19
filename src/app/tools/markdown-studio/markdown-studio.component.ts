import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { hierarchy, tree, type HierarchyPointNode } from 'd3';
import {
  LucideBold,
  LucideBraces,
  LucideCheck,
  LucideChevronDown,
  LucideChevronRight,
  LucideClipboardPaste,
  LucideCode2,
  LucideCopy,
  LucideDownload,
  LucideEye,
  LucideFileCode,
  LucideFileText,
  LucideGitBranch,
  LucideHeading1,
  LucideItalic,
  LucideLink,
  LucideList,
  LucideListChecks,
  LucideMaximize2,
  LucideMinimize2,
  LucidePanelRight,
  LucideQuote,
  LucideRedo2,
  LucideRefreshCw,
  LucideSparkles,
  LucideTable,
  LucideTrash2,
  LucideUndo2,
  LucideUnlink,
  LucideWrapText,
} from '@lucide/angular';
import { countLines, splitLines } from '../../shared/utils/text';
import { ThemeService, type ThemeMode } from '../../shell/theme.service';
import {
  MARKDOWN_HISTORY_LIMIT,
  MARKDOWN_STORAGE_KEY,
  SAMPLE_MARKDOWN,
} from './markdown-studio.constants';
import { MarkdownProcessorService } from './markdown/markdown-processor.service';
import type { MarkdownAstLike, MarkdownView } from './markdown/markdown.types';

type AstDisplayMode = 'graph' | 'tree';

interface EditorSnapshot {
  selectionEnd: number;
  selectionStart: number;
  scrollTop: number;
  value: string;
}

type FormatCommand =
  'bold' | 'code' | 'heading' | 'italic' | 'link' | 'list' | 'quote' | 'table' | 'task';

interface AstExplorerNode {
  childCount: number;
  children: AstExplorerNode[];
  collapsed: boolean;
  depth: number;
  detail: string;
  fullLabel: string;
  id: string;
  label: string;
  type: string;
}

interface AstGraphNode {
  badgeCenterX: number;
  badgeLabel: string;
  badgeWidth: number;
  badgeX: number;
  childCount: number;
  collapsed: boolean;
  detail: string;
  fullLabel: string;
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

interface AstGraphLink {
  id: string;
  path: string;
}

interface AstGraphModel {
  height: number;
  links: AstGraphLink[];
  nodes: AstGraphNode[];
  viewBox: string;
  width: number;
}

function readStoredMarkdown(): string {
  try {
    return localStorage.getItem(MARKDOWN_STORAGE_KEY) || SAMPLE_MARKDOWN;
  } catch {
    return SAMPLE_MARKDOWN;
  }
}

@Component({
  selector: 'markdown-studio',
  imports: [
    CommonModule,
    FormsModule,
    LucideBold,
    LucideBraces,
    LucideCheck,
    LucideChevronDown,
    LucideChevronRight,
    LucideClipboardPaste,
    LucideCode2,
    LucideCopy,
    LucideDownload,
    LucideEye,
    LucideFileCode,
    LucideFileText,
    LucideGitBranch,
    LucideHeading1,
    LucideItalic,
    LucideLink,
    LucideList,
    LucideListChecks,
    LucideMaximize2,
    LucideMinimize2,
    LucidePanelRight,
    LucideQuote,
    LucideRedo2,
    LucideRefreshCw,
    LucideSparkles,
    LucideTable,
    LucideTrash2,
    LucideUndo2,
    LucideUnlink,
    LucideWrapText,
  ],
  templateUrl: './markdown-studio.component.html',
  styleUrl: './markdown-studio.component.scss',
})
export class MarkdownStudioComponent implements AfterViewInit {
  @ViewChild('editor') private readonly markdownEditor?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('previewFrame') private readonly previewFrame?: ElementRef<HTMLIFrameElement>;

  protected readonly activeView = signal<MarkdownView>('preview');
  protected readonly astDisplayMode = signal<AstDisplayMode>('graph');
  protected readonly highlightedElementId = signal<string | null>(null);
  protected readonly markdown = signal(readStoredMarkdown());
  protected readonly outputFullscreen = signal(false);
  protected readonly softWrap = signal(true);
  protected readonly status = signal('Ready');
  protected readonly syncEnabled = signal(true);
  private readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;
  protected readonly savedAt = signal(this.formatTime(new Date()));
  private readonly collapsedAstNodeIds = signal<Set<string>>(new Set());
  private readonly redoStack = signal<EditorSnapshot[]>([]);
  private readonly undoStack = signal<EditorSnapshot[]>([]);
  private readonly previewThemeEffect = effect(() => {
    this.theme();
    window.requestAnimationFrame(() => this.postPreviewState());
  });

  protected readonly canRedo = computed(() => this.redoStack().length > 0);
  protected readonly canUndo = computed(() => this.undoStack().length > 0);
  protected readonly document = computed(() => this.processor.process(this.markdown()));
  protected readonly astJson = computed(() => JSON.stringify(this.document().ast, null, 2));
  protected readonly astRoot = computed(() =>
    this.createAstExplorerNode(
      this.document().ast as MarkdownAstLike,
      '0',
      0,
      this.collapsedAstNodeIds(),
    ),
  );
  protected readonly astVisibleNodes = computed(() => this.flattenVisibleAstNodes(this.astRoot()));
  protected readonly astGraph = computed(() => this.createAstGraph(this.astRoot()));
  protected readonly previewSrcDoc = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.toPreviewHtml()),
  );
  protected readonly lineCount = computed(() => countLines(this.markdown()));
  protected readonly metrics = computed(() => {
    const stats = this.document().stats;
    return [
      { label: 'Words', value: this.formatNumber(stats.words) },
      { label: 'AST nodes', value: this.formatNumber(stats.nodes) },
      { label: 'Blocks', value: this.formatNumber(stats.blocks) },
      { label: 'Links', value: this.formatNumber(stats.links) },
      { label: 'Tables', value: this.formatNumber(stats.tables) },
      { label: 'Read time', value: `${stats.readTimeMinutes} min` },
    ];
  });

  private readonly numberFormat = new Intl.NumberFormat('en-US');

  constructor(
    private readonly processor: MarkdownProcessorService,
    private readonly sanitizer: DomSanitizer,
  ) {}

  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => this.postPreviewState());
  }

  @HostListener('window:message', ['$event'])
  protected handlePreviewMessage(event: MessageEvent): void {
    const data = event.data as { source?: string; type?: string; nodeId?: unknown };

    if (data?.source !== 'md-preview') {
      return;
    }

    if (data.type === 'preview-clear') {
      this.clearHighlight();
      return;
    }

    if (!this.syncEnabled()) {
      return;
    }

    if (
      (data.type === 'preview-hover' || data.type === 'preview-select') &&
      typeof data.nodeId === 'string'
    ) {
      this.highlightElement(data.nodeId);
      this.scrollSourceRowIntoView(data.nodeId);
    }
  }

  @HostListener('window:keydown', ['$event'])
  protected handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.outputFullscreen()) {
      return;
    }

    event.preventDefault();
    this.outputFullscreen.set(false);
    this.status.set('Output restored');
  }

  protected updateMarkdown(value: string, editor?: HTMLTextAreaElement): void {
    if (value === this.markdown()) {
      return;
    }

    this.pushUndoSnapshot(editor);
    this.redoStack.set([]);
    this.markdown.set(value);
    this.clearHighlight();
    this.persist(value);
  }

  protected setView(view: MarkdownView): void {
    this.activeView.set(view);
  }

  protected setAstDisplayMode(mode: AstDisplayMode): void {
    this.astDisplayMode.set(mode);
  }

  protected toggleOutputFullscreen(): void {
    const nextFullscreenState = !this.outputFullscreen();

    this.outputFullscreen.set(nextFullscreenState);
    this.status.set(nextFullscreenState ? 'Output fullscreen' : 'Output restored');
  }

  protected toggleAstNode(nodeId: string): void {
    const node = this.findAstNode(this.astRoot(), nodeId);

    if (!node?.childCount) {
      return;
    }

    this.collapsedAstNodeIds.update((current) => {
      const next = new Set(current);

      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }

      return next;
    });
  }

  protected expandAllAstNodes(): void {
    this.collapsedAstNodeIds.set(new Set());
  }

  protected collapseAllAstNodes(): void {
    const nextCollapsedIds = new Set<string>();

    this.collectCollapsibleAstNodeIds(this.astRoot(), nextCollapsedIds);
    nextCollapsedIds.delete('0');
    this.collapsedAstNodeIds.set(nextCollapsedIds);
  }

  protected toggleWrap(): void {
    this.softWrap.update((value) => !value);
  }

  protected toggleSync(): void {
    const nextSyncState = !this.syncEnabled();

    this.syncEnabled.set(nextSyncState);
    this.clearHighlight();
    this.status.set(nextSyncState ? 'Sync active' : 'Manual scrolling');
    window.requestAnimationFrame(() => this.postPreviewState());
  }

  protected loadSample(): void {
    this.updateMarkdown(SAMPLE_MARKDOWN);
    this.status.set('Sample loaded');
  }

  protected clearEditor(): void {
    if (!window.confirm('Clear the editor?')) {
      return;
    }

    this.updateMarkdown('');
    this.status.set('Editor cleared');
  }

  protected async pasteFromClipboard(editor: HTMLTextAreaElement): Promise<void> {
    if (!navigator.clipboard?.readText) {
      this.status.set('Clipboard unavailable');
      editor.focus();
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      this.replaceSelection(editor, text);
      this.status.set('Clipboard pasted');
    } catch {
      this.status.set('Clipboard permission needed');
      editor.focus();
    }
  }

  protected applyFormat(command: FormatCommand, editor: HTMLTextAreaElement): void {
    switch (command) {
      case 'heading':
        this.prefixSelection(editor, '## ', 'Section title');
        break;
      case 'bold':
        this.wrapSelection(editor, '**', '**', 'strong text');
        break;
      case 'italic':
        this.wrapSelection(editor, '_', '_', 'emphasis');
        break;
      case 'quote':
        this.prefixSelection(editor, '> ', 'Quoted note');
        break;
      case 'list':
        this.prefixSelection(editor, '- ', 'List item');
        break;
      case 'task':
        this.prefixSelection(editor, '- [ ] ', 'Task item');
        break;
      case 'code':
        this.wrapBlock(editor, '```ts\n', '\n```', 'const value = true;');
        break;
      case 'table':
        this.replaceSelection(
          editor,
          '| Column | Detail |\n| :--- | :--- |\n| Parser | Markdown to AST |\n| Renderer | AST to HTML elements |',
        );
        break;
      case 'link':
        this.wrapSelection(editor, '[', '](https://example.com)', 'link text');
        break;
    }
  }

  protected handleEditorKeydown(event: KeyboardEvent, editor: HTMLTextAreaElement): void {
    const key = event.key.toLowerCase();
    const hasShortcutModifier = event.metaKey || event.ctrlKey;

    if (!hasShortcutModifier) {
      return;
    }

    const isUndo = key === 'z' && !event.shiftKey && !event.altKey;
    const isRedo = ((key === 'z' && event.shiftKey) || key === 'y') && !event.altKey;

    if (isUndo && this.canUndo()) {
      event.preventDefault();
      this.undoEditor(editor);
      return;
    }

    if (isRedo && this.canRedo()) {
      event.preventDefault();
      this.redoEditor(editor);
      return;
    }

    const command = this.getFormatCommandForShortcut(event);

    if (command) {
      event.preventDefault();
      this.applyFormat(command, editor);
    }
  }

  protected undoEditor(editor?: HTMLTextAreaElement): void {
    const undoStack = this.undoStack();
    const previous = undoStack.at(-1);

    if (!previous) {
      return;
    }

    this.undoStack.set(undoStack.slice(0, -1));
    this.redoStack.update((stack) => this.trimHistory([...stack, this.captureSnapshot(editor)]));
    this.restoreEditorSnapshot(previous, 'Undo');
  }

  protected redoEditor(editor?: HTMLTextAreaElement): void {
    const redoStack = this.redoStack();
    const next = redoStack.at(-1);

    if (!next) {
      return;
    }

    this.redoStack.set(redoStack.slice(0, -1));
    this.undoStack.update((stack) => this.trimHistory([...stack, this.captureSnapshot(editor)]));
    this.restoreEditorSnapshot(next, 'Redo');
  }

  protected async copyHtml(): Promise<void> {
    await this.copyText(this.document().html, 'HTML copied');
  }

  protected async copyMarkdown(): Promise<void> {
    await this.copyText(this.markdown(), 'Markdown copied');
  }

  protected onPreviewLoaded(): void {
    this.postPreviewState();
  }

  protected isHighlighted(nodeId: string): boolean {
    return this.highlightedElementId() === nodeId;
  }

  protected handleSourceMapHover(event: MouseEvent): void {
    if (!this.syncEnabled()) {
      return;
    }

    const container = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-source-id]')
        : null;
    const nodeId = target?.dataset['sourceId'];

    if (!container || !target || !container.contains(target) || !nodeId) {
      return;
    }

    this.handleSourceRowEnter(nodeId);
  }

  protected handleSourceRowEnter(nodeId: string): void {
    if (!this.syncEnabled()) {
      return;
    }

    if (this.highlightedElementId() === nodeId) {
      return;
    }

    this.highlightElement(nodeId, { scrollPreview: true });
  }

  protected handleSourceMapLeave(): void {
    this.clearHighlight();
  }

  protected handleSourceMapFocusOut(event: FocusEvent): void {
    const container = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;

    if (!container || !nextTarget || !container.contains(nextTarget)) {
      this.clearHighlight();
    }
  }

  protected downloadHtml(): void {
    const html = this.toStandaloneHtml();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = 'markdown-export.html';
    anchor.click();
    URL.revokeObjectURL(url);
    this.status.set('HTML downloaded');
  }

  protected formatNumber(value: number): string {
    return this.numberFormat.format(value);
  }

  private createAstExplorerNode(
    node: MarkdownAstLike,
    path: string,
    depth: number,
    collapsedIds: Set<string>,
  ): AstExplorerNode {
    const children = this.getAstChildren(node).map((child, index) =>
      this.createAstExplorerNode(child, `${path}.${index}`, depth + 1, collapsedIds),
    );

    return {
      childCount: children.length,
      children,
      collapsed: collapsedIds.has(path),
      depth,
      detail: this.getAstDetail(node),
      fullLabel: this.getAstLabel(node, Number.POSITIVE_INFINITY),
      id: path,
      label: this.getAstLabel(node),
      type: String(node.type ?? 'unknown'),
    };
  }

  private flattenVisibleAstNodes(root: AstExplorerNode): AstExplorerNode[] {
    const rows: AstExplorerNode[] = [];

    const walk = (node: AstExplorerNode): void => {
      rows.push(node);

      if (!node.collapsed) {
        node.children.forEach(walk);
      }
    };

    walk(root);
    return rows;
  }

  private createAstGraph(root: AstExplorerNode): AstGraphModel {
    const nodeWidth = 156;
    const nodeHeight = 50;
    const margin = 32;
    const layoutRoot = tree<AstExplorerNode>()
      .nodeSize([82, 212])
      .separation((left, right) => (left.parent === right.parent ? 1 : 1.3))(
      hierarchy(root, (node) => (node.collapsed ? [] : node.children)),
    );
    const d3Nodes = layoutRoot.descendants();
    const d3Links = layoutRoot.links();
    const minX = Math.min(...d3Nodes.map((node) => node.x), 0);
    const maxX = Math.max(...d3Nodes.map((node) => node.x), 0);
    const maxY = Math.max(...d3Nodes.map((node) => node.y), 0);
    const width = Math.ceil(maxY + nodeWidth + margin * 2);
    const height = Math.ceil(maxX - minX + nodeHeight + margin * 2);
    const toX = (node: HierarchyPointNode<AstExplorerNode>): number => node.y + margin;
    const toY = (node: HierarchyPointNode<AstExplorerNode>): number => node.x - minX + margin;

    return {
      height,
      links: d3Links.map((link) =>
        this.createAstGraphLink(link.source, link.target, toX, toY, nodeWidth, nodeHeight),
      ),
      nodes: d3Nodes.map((node) => {
        const badgeLabel = node.data.collapsed ? '+' : String(node.data.childCount);
        const badgeWidth = Math.max(22, badgeLabel.length * 8 + 12);
        const badgeX = nodeWidth - badgeWidth - 8;

        return {
          badgeCenterX: badgeX + badgeWidth / 2,
          badgeLabel,
          badgeWidth,
          badgeX,
          childCount: node.data.childCount,
          collapsed: node.data.collapsed,
          detail: node.data.detail,
          fullLabel: node.data.fullLabel,
          id: node.data.id,
          label: this.truncate(node.data.label, 25),
          type: node.data.type,
          x: toX(node),
          y: toY(node),
        };
      }),
      viewBox: `0 0 ${width} ${height}`,
      width,
    };
  }

  private createAstGraphLink(
    source: HierarchyPointNode<AstExplorerNode>,
    target: HierarchyPointNode<AstExplorerNode>,
    toX: (node: HierarchyPointNode<AstExplorerNode>) => number,
    toY: (node: HierarchyPointNode<AstExplorerNode>) => number,
    nodeWidth: number,
    nodeHeight: number,
  ): AstGraphLink {
    const sourceX = toX(source) + nodeWidth;
    const sourceY = toY(source) + nodeHeight / 2;
    const targetX = toX(target);
    const targetY = toY(target) + nodeHeight / 2;
    const midpoint = sourceX + (targetX - sourceX) / 2;

    return {
      id: `${source.data.id}-${target.data.id}`,
      path: `M ${sourceX} ${sourceY} C ${midpoint} ${sourceY}, ${midpoint} ${targetY}, ${targetX} ${targetY}`,
    };
  }

  private findAstNode(root: AstExplorerNode, nodeId: string): AstExplorerNode | null {
    if (root.id === nodeId) {
      return root;
    }

    for (const child of root.children) {
      const match = this.findAstNode(child, nodeId);

      if (match) {
        return match;
      }
    }

    return null;
  }

  private collectCollapsibleAstNodeIds(node: AstExplorerNode, ids: Set<string>): void {
    if (node.childCount) {
      ids.add(node.id);
    }

    node.children.forEach((child) => this.collectCollapsibleAstNodeIds(child, ids));
  }

  private getAstChildren(node: MarkdownAstLike | undefined): MarkdownAstLike[] {
    return Array.isArray(node?.children) ? node.children : [];
  }

  private getAstLabel(node: MarkdownAstLike, maxValueLength = 44): string {
    const formatValue = (value: unknown): string =>
      this.truncate(String(value ?? ''), maxValueLength);

    if (node.type === 'heading') {
      return `heading ${node['depth'] ?? ''}`.trim();
    }

    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      return `${node.type}: ${formatValue(node.value)}`;
    }

    if (node.type === 'link' || node.type === 'image') {
      return `${node.type}: ${formatValue(node['url'])}`;
    }

    return String(node.type ?? 'unknown');
  }

  private getAstDetail(node: MarkdownAstLike): string {
    const position = node.position?.start?.line ? `line ${node.position.start.line}` : '';
    const childCount = this.getAstChildren(node).length;
    const childLabel = childCount === 1 ? '1 child' : `${childCount} children`;

    return [position, childCount ? childLabel : 'leaf'].filter(Boolean).join(' · ');
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    if (maxLength <= 3) {
      return value.slice(0, maxLength);
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }

  private getFormatCommandForShortcut(event: KeyboardEvent): FormatCommand | null {
    const key = event.key.toLowerCase();

    if (event.altKey) {
      if (key === '1') {
        return 'heading';
      }

      if (key === 't') {
        return 'table';
      }

      return null;
    }

    if (event.shiftKey) {
      if (key === '.' || key === '>') {
        return 'quote';
      }

      if (key === '8' || key === '*') {
        return 'list';
      }

      if (key === '9' || key === '(') {
        return 'task';
      }

      return null;
    }

    switch (key) {
      case 'b':
        return 'bold';
      case 'e':
        return 'code';
      case 'i':
        return 'italic';
      case 'k':
        return 'link';
      default:
        return null;
    }
  }

  private highlightElement(nodeId: string, options: { scrollPreview?: boolean } = {}): void {
    if (!this.syncEnabled()) {
      return;
    }

    this.highlightedElementId.set(nodeId);
    this.postToPreview({ type: 'highlight', nodeId, scroll: Boolean(options.scrollPreview) });
  }

  private clearHighlight(): void {
    this.highlightedElementId.set(null);
    this.postToPreview({ type: 'clear-highlight' });
  }

  private postPreviewState(): void {
    this.postToPreview({
      type: 'state',
      nodeId: this.highlightedElementId(),
      syncEnabled: this.syncEnabled(),
      theme: this.theme(),
    });
  }

  private postToPreview(message: Record<string, unknown>): void {
    this.previewFrame?.nativeElement.contentWindow?.postMessage(
      {
        source: 'md-studio',
        ...message,
      },
      '*',
    );
  }

  private scrollSourceRowIntoView(nodeId: string): void {
    window.requestAnimationFrame(() => {
      const row = window.document.querySelector<HTMLElement>(`[data-source-id="${nodeId}"]`);
      const container = row?.closest<HTMLElement>('.source-map');

      if (!row || !container) {
        return;
      }

      const rowRect = row.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const padding = 12;

      if (rowRect.top < containerRect.top + padding) {
        container.scrollBy({
          top: rowRect.top - containerRect.top - padding,
          behavior: 'smooth',
        });
      }

      if (rowRect.bottom > containerRect.bottom - padding) {
        container.scrollBy({
          top: rowRect.bottom - containerRect.bottom + padding,
          behavior: 'smooth',
        });
      }
    });
  }

  private persist(value: string): void {
    try {
      localStorage.setItem(MARKDOWN_STORAGE_KEY, value);
      this.savedAt.set(this.formatTime(new Date()));
      this.status.set('Saved locally');
    } catch {
      this.status.set('Local save unavailable');
    }
  }

  private replaceSelection(editor: HTMLTextAreaElement, value: string): void {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const scrollTop = editor.scrollTop;
    const next = `${editor.value.slice(0, start)}${value}${editor.value.slice(end)}`;

    this.updateMarkdown(next, editor);
    this.restoreSelection(editor, start, start + value.length, scrollTop);
  }

  private wrapSelection(
    editor: HTMLTextAreaElement,
    before: string,
    after: string,
    fallback: string,
  ): void {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const scrollTop = editor.scrollTop;
    const selected = editor.value.slice(start, end) || fallback;
    const insertion = `${before}${selected}${after}`;
    const next = `${editor.value.slice(0, start)}${insertion}${editor.value.slice(end)}`;
    const selectionStart = start + before.length;

    this.updateMarkdown(next, editor);
    this.restoreSelection(editor, selectionStart, selectionStart + selected.length, scrollTop);
  }

  private wrapBlock(
    editor: HTMLTextAreaElement,
    before: string,
    after: string,
    fallback: string,
  ): void {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const scrollTop = editor.scrollTop;
    const selected = editor.value.slice(start, end) || fallback;
    const prefix = start > 0 && !editor.value.slice(0, start).endsWith('\n') ? '\n' : '';
    const suffix = editor.value.slice(end).startsWith('\n') ? '' : '\n';
    const insertion = `${prefix}${before}${selected}${after}${suffix}`;
    const next = `${editor.value.slice(0, start)}${insertion}${editor.value.slice(end)}`;
    const selectionStart = start + prefix.length + before.length;

    this.updateMarkdown(next, editor);
    this.restoreSelection(editor, selectionStart, selectionStart + selected.length, scrollTop);
  }

  private prefixSelection(editor: HTMLTextAreaElement, prefix: string, fallback: string): void {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const scrollTop = editor.scrollTop;
    const selected = editor.value.slice(start, end) || fallback;
    const insertion = splitLines(selected)
      .map((line) => `${prefix}${line}`)
      .join('\n');
    const next = `${editor.value.slice(0, start)}${insertion}${editor.value.slice(end)}`;

    this.updateMarkdown(next, editor);
    this.restoreSelection(editor, start + prefix.length, start + insertion.length, scrollTop);
  }

  private pushUndoSnapshot(editor?: HTMLTextAreaElement): void {
    const snapshot = this.captureSnapshot(editor);

    this.undoStack.update((stack) => {
      const previous = stack.at(-1);

      if (
        previous?.value === snapshot.value &&
        previous.selectionStart === snapshot.selectionStart &&
        previous.selectionEnd === snapshot.selectionEnd
      ) {
        return stack;
      }

      return this.trimHistory([...stack, snapshot]);
    });
  }

  private restoreEditorSnapshot(snapshot: EditorSnapshot, status: string): void {
    const editor = this.markdownEditor?.nativeElement;

    this.markdown.set(snapshot.value);
    this.clearHighlight();
    this.persist(snapshot.value);
    this.status.set(status);

    if (editor) {
      this.restoreSelection(
        editor,
        snapshot.selectionStart,
        snapshot.selectionEnd,
        snapshot.scrollTop,
      );
    }
  }

  private captureSnapshot(editor?: HTMLTextAreaElement): EditorSnapshot {
    const value = this.markdown();
    const activeEditor = editor ?? this.markdownEditor?.nativeElement;
    const selectionStart = activeEditor
      ? this.clampSelection(activeEditor.selectionStart, value)
      : value.length;
    const selectionEnd = activeEditor
      ? this.clampSelection(activeEditor.selectionEnd, value)
      : value.length;
    const scrollTop = activeEditor?.scrollTop ?? 0;

    return { value, selectionStart, selectionEnd, scrollTop };
  }

  private clampSelection(position: number, value: string): number {
    return Math.min(Math.max(position, 0), value.length);
  }

  private trimHistory(history: EditorSnapshot[]): EditorSnapshot[] {
    return history.slice(-MARKDOWN_HISTORY_LIMIT);
  }

  private restoreSelection(
    editor: HTMLTextAreaElement,
    start: number,
    end: number,
    scrollTop = editor.scrollTop,
  ): void {
    window.requestAnimationFrame(() => {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(start, end);
      editor.scrollTop = scrollTop;

      window.requestAnimationFrame(() => {
        editor.scrollTop = scrollTop;
      });
    });
  }

  private async copyText(value: string, successStatus: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      this.status.set('Clipboard unavailable');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      this.status.set(successStatus);
    } catch {
      this.status.set('Clipboard permission needed');
    }
  }

  private toStandaloneHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Markdown export</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #242928; background: #f6f8f4; }
    main { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
    pre, code { font-family: "SFMono-Regular", Consolas, monospace; }
    pre { overflow: auto; padding: 16px; border: 1px solid #d6ddd8; background: #101615; color: #e8f4ee; border-radius: 8px; }
    code.inline-code { padding: 2px 5px; border-radius: 4px; background: #edf4f0; }
    blockquote { margin: 24px 0; padding-left: 16px; border-left: 3px solid #0f766e; color: #4b5652; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d6ddd8; padding: 10px 12px; }
    img { max-width: 100%; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
${this.document().html}
  </main>
</body>
</html>`;
  }

  private toPreviewHtml(): string {
    const theme = this.theme();

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Generated HTML preview</title>
  <style>${this.previewCss(theme)}</style>
</head>
<body data-theme="${theme}">
  <main class="preview-document">
${this.document().annotatedHtml}
  </main>
  <script>
    (() => {
      let active = null;
      let hovered = null;
      let syncEnabled = true;

      const blockSelector = [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'blockquote', 'li', 'pre', 'table', 'th', 'td',
        'img', 'hr', '.table-shell'
      ].map((selector) => selector + '[data-preview-id]').join(',');
      const getNode = (id) => id ? document.querySelector('[data-preview-id="' + id + '"]') : null;
      const getHoverTarget = (event) => {
        const element = event.target?.closest?.('[data-preview-id]');
        if (!element) return null;
        return event.target.closest?.(blockSelector) || element;
      };
      const clear = () => {
        active?.classList.remove('md-preview-highlight');
        active = null;
      };
      const highlight = (id, scroll) => {
        clear();
        const next = getNode(id);
        if (!next) return;
        active = next;
        active.classList.add('md-preview-highlight');
        if (scroll) {
          active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
      };
      const post = (type, nodeId) => parent.postMessage({ source: 'md-preview', type, nodeId }, '*');

      window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.source !== 'md-studio') return;
        if (data.type === 'state') {
          if (data.theme) document.body.dataset.theme = data.theme;
          if (typeof data.syncEnabled === 'boolean') syncEnabled = data.syncEnabled;
          if (!syncEnabled) {
            hovered = null;
            clear();
            return;
          }
          if (data.nodeId) highlight(data.nodeId, false);
          if (!data.nodeId) clear();
        }
        if (data.type === 'highlight' && syncEnabled) highlight(data.nodeId, Boolean(data.scroll));
        if (data.type === 'clear-highlight') clear();
      });

      document.addEventListener('mouseover', (event) => {
        if (!syncEnabled) return;
        const target = getHoverTarget(event);
        if (!target || target.dataset.previewId === hovered?.dataset.previewId) return;
        hovered = target;
        highlight(target.dataset.previewId, false);
        post('preview-hover', target.dataset.previewId);
      });

      document.addEventListener('mouseout', (event) => {
        if (!syncEnabled) return;
        if (!hovered) return;
        const related = event.relatedTarget;
        const next = related?.closest?.('[data-preview-id]');
        if (next && hovered.contains(next)) return;
        hovered = null;
        clear();
        post('preview-clear');
      });
    })();
  <\/script>
</body>
</html>`;
  }

  private previewCss(theme: ThemeMode): string {
    const dark = theme === 'dark';
    return `
      :root {
        color-scheme: ${dark ? 'dark' : 'light'};
        --accent: ${dark ? '#5eead4' : '#0f766e'};
        --accent-soft: ${dark ? 'rgba(94, 234, 212, 0.18)' : 'rgba(15, 118, 110, 0.14)'};
        --bg: ${dark ? '#111715' : '#ffffff'};
        --code-bg: ${dark ? '#080d0c' : '#111715'};
        --code-ink: ${dark ? '#dff8f0' : '#e7f3ef'};
        --ink: ${dark ? '#e9f3ef' : '#26302c'};
        --line: ${dark ? '#2d3a35' : '#d6ddd8'};
        --muted: ${dark ? '#a8b8b2' : '#4d5955'};
        --table-head: ${dark ? '#17211e' : '#f0f5f2'};
      }
      * { box-sizing: border-box; }
      html { min-height: 100%; background: var(--bg); }
      body {
        min-height: 100%;
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .preview-document {
        max-width: 880px;
        margin: 0;
        padding: 32px;
      }
      :is(h1, h2, h3, h4, h5, h6) { margin: 1.2em 0 0.5em; line-height: 1.15; }
      h1 { margin-top: 0; font-size: 2rem; }
      h2 { font-size: 1.45rem; }
      p, li { line-height: 1.7; }
      a { color: var(--accent); font-weight: 750; }
      blockquote { margin: 22px 0; padding: 4px 0 4px 16px; border-left: 3px solid var(--accent); color: var(--muted); }
      .inline-code { padding: 2px 5px; border: 1px solid var(--line); border-radius: 4px; background: var(--accent-soft); font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
      pre { overflow: auto; margin: 16px 0; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--code-bg); color: var(--code-ink); font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.86rem; line-height: 1.65; }
      .code-block { position: relative; }
      .code-block::before { position: absolute; top: 8px; right: 10px; color: #9bb5ac; content: attr(data-language); font-size: 0.68rem; font-weight: 800; text-transform: uppercase; }
      ul.contains-task-list { padding-left: 0; list-style: none; }
      .task-list-item { display: flex; align-items: flex-start; gap: 9px; }
      input[type='checkbox'] { width: 16px; height: 16px; margin-top: 7px; accent-color: var(--accent); }
      .table-shell { overflow-x: auto; margin: 22px 0; border: 1px solid var(--line); border-radius: 8px; }
      table { width: 100%; min-width: 520px; border-collapse: collapse; }
      th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { background: var(--table-head); font-size: 0.78rem; text-transform: uppercase; }
      tr:last-child td { border-bottom: 0; }
      img { max-width: 100%; border-radius: 8px; }
      .md-preview-highlight {
        outline: 3px solid var(--accent);
        outline-offset: 4px;
        background-color: var(--accent-soft);
        box-shadow: 0 0 0 8px var(--accent-soft);
        border-radius: 4px;
        transition: outline-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
      }
      [data-preview-id] { cursor: default; }
      @media (max-width: 680px) { .preview-document { padding: 22px; } table { min-width: 460px; } }
    `;
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
