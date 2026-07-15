import { MarkdownProcessorService } from './markdown-processor.service';
import { MarkdownRendererService } from './markdown-renderer.service';

describe('MarkdownProcessorService', () => {
  let processor: MarkdownProcessorService;

  beforeEach(() => {
    processor = new MarkdownProcessorService(new MarkdownRendererService());
  });

  it('should convert markdown into AST, element rows, and HTML', () => {
    const document = processor.process(`# Title

- [x] Done

| A | B |
| :- | -: |
| left | right |
`);

    expect(document.ast.type).toBe('root');
    expect(document.html).toContain('<h1 id="title">Title</h1>');
    expect(document.html).not.toContain('data-preview-id');
    expect(document.annotatedHtml).toContain('data-preview-id="el-0"');
    expect(document.html).toContain('type="checkbox"');
    expect(document.html).toContain('<table>');
    expect(document.sourceRows[0]).toMatchObject({
      nodeId: 'el-0',
      openingTag: '<h1 id="title">',
      tag: 'h1',
    });
    expect(document.astTree.length).toBeGreaterThan(1);
    expect(document.elementTree.length).toBeGreaterThan(1);
    expect(document.stats.headings).toEqual([{ depth: 1, slug: 'title', text: 'Title' }]);
    expect(document.stats.taskItems).toBe(1);
    expect(document.stats.tables).toBe(1);
  });

  it('should neutralize raw html and unsafe urls', () => {
    const document = processor.process(`<script>alert('x')</script>

[bad](javascript:alert('x'))
`);

    expect(document.html).toContain('&lt;script&gt;alert');
    expect(document.html).not.toContain('<script>');
    expect(document.html).toContain('href="#"');
  });
});
