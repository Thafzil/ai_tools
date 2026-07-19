export const MARKDOWN_HISTORY_LIMIT = 100;
export const MARKDOWN_STORAGE_KEY = 'decoders.markdown.source';

export const SAMPLE_MARKDOWN = `# Product Release Notes

> Convert Markdown into a transparent AST, then render it through a typed element model.

## Highlights

- **Live Markdown editor** with copy, paste, and export actions
- GFM tables, task lists, links, images, and code blocks
- AST rows and HTML element rows kept side by side
- [Angular](https://angular.dev) friendly service boundaries

## Delivery Checklist

- [x] Parse Markdown into mdast
- [x] Convert AST nodes into HTML element models
- [x] Render safe HTML for preview
- [ ] Add backend persistence when the workflow needs teams

## Example Table

| Layer | Responsibility | Status |
| :--- | :--- | :---: |
| Parser | Markdown to AST | Ready |
| Renderer | AST to element model | Ready |
| Preview | Element model to HTML | Ready |

\`\`\`ts
const document = markdownProcessor.process(source);
const html = document.html;
\`\`\`
`;
