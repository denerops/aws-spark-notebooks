export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Shared CSS for extension config / form webviews (VS Code settings-style). */
export const WEBVIEW_FORM_STYLES = `
  :root {
    --section-gap: 2rem;
    --field-gap: 12px;
    --card-radius: 8px;
    --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    --input-border: var(--vscode-input-border, var(--border));
    --muted: var(--vscode-descriptionForeground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.55;
    max-width: 920px;
    margin: 0 auto;
    padding: 1.5rem 2rem 3rem;
  }
  .page-header {
    margin-bottom: var(--section-gap);
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  .page-header h1 {
    font-size: 1.65rem;
    font-weight: 600;
    margin: 0 0 0.35rem;
  }
  .page-description {
    color: var(--muted);
    margin: 0;
    font-size: 0.92rem;
  }
  .settings-group {
    margin-bottom: var(--section-gap);
    scroll-margin-top: 1rem;
  }
  .settings-group > h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0 0 0.85rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid var(--border);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 1rem;
    font-size: 0.92rem;
  }
  .field:last-child { margin-bottom: 0; }
  .field-label {
    font-weight: 500;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--field-gap);
  }
  @media (max-width: 640px) {
    .grid { grid-template-columns: 1fr; }
  }
  input, textarea, select {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 6px 8px;
    font: inherit;
    width: 100%;
  }
  input:focus, textarea:focus, select:focus {
    outline: 1px solid var(--vscode-focusBorder, var(--vscode-textLink-foreground));
    outline-offset: -1px;
  }
  textarea {
    min-height: 100px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.88rem;
  }
  .hint {
    font-size: 0.82rem;
    color: var(--muted);
    margin: 0.35rem 0 0;
    line-height: 1.45;
  }
  .kv-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .kv-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 8px;
    align-items: start;
  }
  .kv-key-wrap { position: relative; min-width: 0; }
  .kv-suggestions {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 20;
    max-height: 220px;
    overflow-y: auto;
    background: var(--vscode-dropdown-background, var(--input-bg));
    color: var(--vscode-dropdown-foreground, var(--input-fg));
    border: 1px solid var(--border);
    border-radius: var(--card-radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .kv-suggestions[hidden] { display: none; }
  .kv-suggestion {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    border: none;
    border-bottom: 1px solid var(--border);
    padding: 8px 10px;
    cursor: pointer;
    font: inherit;
  }
  .kv-suggestion:last-child { border-bottom: none; }
  .kv-suggestion:hover,
  .kv-suggestion.active {
    background: var(--vscode-list-hoverBackground);
  }
  .kv-suggestion-key {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.85rem;
    word-break: break-all;
  }
  .kv-suggestion-value {
    font-size: 0.78rem;
    color: var(--muted);
    word-break: break-all;
  }
  .kv-suggestion-desc {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .package-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .package-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
  }
  @media (max-width: 640px) {
    .kv-row { grid-template-columns: 1fr; }
    .kv-row .btn-icon { justify-self: start; }
  }
  .btn-icon {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--border);
    border-radius: 4px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    font: inherit;
    line-height: 1;
    padding: 0;
  }
  .btn-icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 0.45rem 0.85rem;
    font-size: inherit;
    font-family: inherit;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: var(--section-gap);
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
  button.danger {
    background: transparent;
    color: var(--vscode-errorForeground);
    border: 1px solid var(--vscode-errorForeground);
  }
  button.danger:hover {
    background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
  }
  .empty-state {
    color: var(--muted);
    padding: 2rem 0;
  }
`;

export function renderWebviewPage(options: {
  title: string;
  extraStyles?: string;
  body: string;
  script?: string;
}): string {
  const extraStyles = options.extraStyles ? `\n${options.extraStyles}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
  <style>
${WEBVIEW_FORM_STYLES}${extraStyles}
  </style>
</head>
<body>
${options.body}
${options.script ? `<script>\n${options.script}\n</script>` : ''}
</body>
</html>`;
}
