import { TestBed } from '@angular/core/testing';
import { MarkdownStudioComponent } from './markdown-studio.component';

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

describe('MarkdownStudioComponent', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [MarkdownStudioComponent],
    }).compileComponents();
  });

  it('should create the tool', () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the markdown workbench', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Markdown AST Studio');
    expect(compiled.querySelector('textarea')).toBeTruthy();
    expect(compiled.querySelector('.html-preview-frame')).toBeTruthy();
    expect(compiled.querySelector('.inspect-button')).toBeFalsy();
    expect(compiled.querySelector('.source-map')?.textContent).toContain(
      '<h1 id="product-release-notes">',
    );
  });

  it('should toggle fullscreen mode for the output panel', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const outputPanel = compiled.querySelector<HTMLElement>('.output-panel');
    const fullscreenButton = compiled.querySelector<HTMLButtonElement>(
      'button[aria-label="Enter output fullscreen"]',
    );

    expect(outputPanel).toBeTruthy();
    expect(fullscreenButton).toBeTruthy();

    fullscreenButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(outputPanel?.classList.contains('is-fullscreen')).toBe(true);
    expect(
      compiled.querySelector<HTMLButtonElement>('button[aria-label="Exit output fullscreen"]')
        ?.title,
    ).toContain('Esc');

    const escapeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    });
    window.dispatchEvent(escapeEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(outputPanel?.classList.contains('is-fullscreen')).toBe(false);
  });

  it('should highlight a preview element from generated HTML hover', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const sourceMap = compiled.querySelector<HTMLElement>('.source-map');
    const row = compiled.querySelector<HTMLElement>('.source-row[data-source-id="el-0"]');
    const nestedTag = row?.querySelector<HTMLElement>('.source-tag');

    expect(sourceMap).toBeTruthy();
    expect(row).toBeTruthy();
    expect(nestedTag).toBeTruthy();

    nestedTag?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    expect(row?.classList.contains('is-highlighted')).toBe(true);
    expect(compiled.querySelector('.source-pane-header span')?.textContent?.trim()).toBe('el-0');

    sourceMap?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    fixture.detectChanges();

    expect(row?.classList.contains('is-highlighted')).toBe(false);
  });

  it('should pause synchronized highlight and scrolling from the toolbar', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const syncButton = compiled.querySelector<HTMLButtonElement>('.sync-toggle');
    const row = compiled.querySelector<HTMLElement>('.source-row[data-source-id="el-0"]');
    const nestedTag = row?.querySelector<HTMLElement>('.source-tag');

    expect(syncButton).toBeTruthy();
    expect(row).toBeTruthy();
    expect(nestedTag).toBeTruthy();

    syncButton?.click();
    fixture.detectChanges();

    nestedTag?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    expect(syncButton?.textContent).toContain('Manual');
    expect(syncButton?.getAttribute('aria-pressed')).toBe('false');
    expect(row?.classList.contains('is-highlighted')).toBe(false);
    expect(compiled.querySelector('.source-pane-header span')?.textContent?.trim()).toBe('manual');
  });

  it('should undo and redo editor toolbar actions from buttons and shortcuts', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea');
    const boldButton = compiled.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    const undoButton = compiled.querySelector<HTMLButtonElement>('button[aria-label="Undo"]');
    const redoButton = compiled.querySelector<HTMLButtonElement>('button[aria-label="Redo"]');

    expect(textarea).toBeTruthy();
    expect(boldButton).toBeTruthy();
    expect(undoButton).toBeTruthy();
    expect(redoButton).toBeTruthy();

    const initialMarkdown = textarea?.value ?? '';
    const productStart = initialMarkdown.indexOf('Product');
    const productEnd = productStart + 'Product'.length;

    textarea?.focus();
    textarea?.setSelectionRange(productStart, productEnd);
    boldButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const boldMarkdown = initialMarkdown.replace('Product', '**Product**');
    expect(textarea?.value).toBe(boldMarkdown);
    expect(undoButton?.disabled).toBe(false);

    undoButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(textarea?.value).toBe(initialMarkdown);
    expect(redoButton?.disabled).toBe(false);

    redoButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(textarea?.value).toBe(boldMarkdown);

    const undoEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z',
    });
    textarea?.dispatchEvent(undoEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(undoEvent.defaultPrevented).toBe(true);
    expect(textarea?.value).toBe(initialMarkdown);

    const redoEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z',
      shiftKey: true,
    });
    textarea?.dispatchEvent(redoEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(redoEvent.defaultPrevented).toBe(true);
    expect(textarea?.value).toBe(boldMarkdown);
  });

  it('should show and apply formatting keyboard shortcuts', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea');
    const boldButton = compiled.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    const italicButton = compiled.querySelector<HTMLButtonElement>('button[aria-label="Italic"]');
    const linkButton = compiled.querySelector<HTMLButtonElement>('button[aria-label="Link"]');

    expect(textarea).toBeTruthy();
    expect(boldButton?.title).toContain('Ctrl/Command + B');
    expect(italicButton?.title).toContain('Ctrl/Command + I');
    expect(linkButton?.title).toContain('Ctrl/Command + K');

    const initialMarkdown = textarea?.value ?? '';
    const productStart = initialMarkdown.indexOf('Product');
    const productEnd = productStart + 'Product'.length;

    textarea?.focus();
    textarea?.setSelectionRange(productStart, productEnd);

    const boldEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'b',
    });
    textarea?.dispatchEvent(boldEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(boldEvent.defaultPrevented).toBe(true);
    expect(textarea?.value).toBe(initialMarkdown.replace('Product', '**Product**'));
  });

  it('should preserve editor scroll when formatting selected text', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea');
    const boldButton = compiled.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');

    expect(textarea).toBeTruthy();
    expect(boldButton).toBeTruthy();

    const initialMarkdown = textarea?.value ?? '';
    const highlightsStart = initialMarkdown.indexOf('Highlights');
    const highlightsEnd = highlightsStart + 'Highlights'.length;

    textarea!.scrollTop = 256;
    textarea?.focus();
    textarea?.setSelectionRange(highlightsStart, highlightsEnd);
    boldButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    await nextAnimationFrame();
    await nextAnimationFrame();

    expect(textarea?.value).toContain('## **Highlights**');
    expect(textarea?.scrollTop).toBe(256);
  });

  it('should render an expandable AST tree and keep raw JSON available', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    findButtonByText(compiled, 'AST')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    findButtonByText(compiled, 'Tree')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const headingRow = compiled.querySelector<HTMLElement>('.ast-node-row[data-ast-id="0.0"]');
    const headingChild = compiled.querySelector<HTMLElement>('.ast-node-row[data-ast-id="0.0.0"]');
    const toggle = headingRow?.querySelector<HTMLButtonElement>('.ast-node-toggle');

    expect(compiled.querySelector('.ast-workbench')).toBeTruthy();
    expect(compiled.querySelector('.json-drawer')?.textContent).toContain('Raw AST JSON');
    expect(headingRow).toBeTruthy();
    expect(headingChild).toBeTruthy();
    expect(toggle?.disabled).toBe(false);

    toggle?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      compiled
        .querySelector<HTMLElement>('.ast-node-row[data-ast-id="0.0"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(compiled.querySelector('.ast-node-row[data-ast-id="0.0.0"]')).toBeFalsy();
  });

  it('should render the AST graph view with D3 layout data', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    findButtonByText(compiled, 'AST')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const svg = compiled.querySelector<SVGSVGElement>('.ast-graph-svg');
    const graphButton = findButtonByText(compiled, 'Graph');
    const treeButton = findButtonByText(compiled, 'Tree');
    const graphLabels = Array.from(compiled.querySelectorAll<SVGTextElement>('.ast-graph-label'));
    const graphTitles = Array.from(
      compiled.querySelectorAll<SVGTitleElement>('.ast-graph-node title'),
    );
    const badge = compiled.querySelector<SVGRectElement>('.ast-graph-badge');

    expect(graphButton?.getAttribute('aria-selected')).toBe('true');
    expect(treeButton?.getAttribute('aria-selected')).toBe('false');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    expect(compiled.querySelectorAll('.ast-graph-node').length).toBeGreaterThan(1);
    expect(compiled.querySelectorAll('.ast-graph-link').length).toBeGreaterThan(0);
    expect(graphLabels.some((label) => label.textContent?.includes('...'))).toBe(true);
    expect(
      graphTitles.some((title) =>
        title.textContent?.includes('Convert Markdown into a transparent AST'),
      ),
    ).toBe(true);
    expect(Number(badge?.getAttribute('width'))).toBeGreaterThanOrEqual(22);
    expect(compiled.querySelector('.json-drawer')?.textContent).toContain('Raw AST JSON');
  });

  it('should size AST graph count badges for two-digit child counts', async () => {
    const fixture = TestBed.createComponent(MarkdownStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea');
    const denseMarkdown = Array.from({ length: 12 }, (_, index) => `## Section ${index + 1}`).join(
      '\n\n',
    );

    expect(textarea).toBeTruthy();

    textarea!.value = denseMarkdown;
    textarea!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    findButtonByText(compiled, 'AST')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const rootGraphNode = compiled.querySelector<SVGGElement>('.ast-graph-node');
    const badge = rootGraphNode?.querySelector<SVGRectElement>('.ast-graph-badge');
    const count = rootGraphNode?.querySelector<SVGTextElement>('.ast-graph-count');

    expect(count?.textContent?.trim()).toBe('12');
    expect(Number(badge?.getAttribute('width'))).toBeGreaterThan(22);
  });
});
