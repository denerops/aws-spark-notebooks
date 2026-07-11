import type { ActivationFunction } from 'vscode-notebook-renderer';
import styles from '../../media/tableRenderer.css';
import type { QueryResultPayload } from '../output/tableModel';
import {
  classifyColumn,
  renderCellHtml,
  stringifyCell,
} from '../output/tableModel';
import { styleForInferredKind } from '../output/columnTypeStyle';

const ERROR_MIME = 'application/vnd.emr-spark.error+json';

interface ErrorPayload {
  message: string;
  executionTimeMs?: number;
}

type SortDir = 'asc' | 'desc' | null;

interface OutputViewState {
  payload: QueryResultPayload;
  footerLeft: HTMLSpanElement;
}

const outputViews = new Map<string, OutputViewState>();

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : 1;
  return stringifyCell(a).localeCompare(stringifyCell(b), undefined, { numeric: true });
}

function rowMatchesFilter(row: unknown[], filter: string): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return row.some((cell) => stringifyCell(cell).toLowerCase().includes(needle));
}

function ensureRendererStyles(element: HTMLElement): void {
  if (element.querySelector('style[data-emr-renderer]')) {
    return;
  }
  const style = document.createElement('style');
  style.setAttribute('data-emr-renderer', 'true');
  style.textContent = styles;
  element.prepend(style);
}

function formatRowSummary(payload: QueryResultPayload, filteredVisible?: number): string {
  if (filteredVisible !== undefined) {
    return `${filteredVisible.toLocaleString()} of ${payload.rows.length.toLocaleString()} rows shown`;
  }

  if (payload.truncated) {
    return `Showing ${payload.rowCount.toLocaleString()}+ rows`;
  }

  return `${payload.rowCount.toLocaleString()} row(s)`;
}

function applyPayloadToView(state: OutputViewState): void {
  state.footerLeft.textContent = formatRowSummary(state.payload);
}

const COPY_ICON_SVG =
  '<svg class="duckdb-error-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const CHECK_ICON_SVG =
  '<svg class="duckdb-error-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function setCopyButtonIcon(button: HTMLButtonElement, icon: 'copy' | 'check'): void {
  button.innerHTML = icon === 'copy' ? COPY_ICON_SVG : CHECK_ICON_SVG;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function renderErrorOutput(outputItem: { id: string; json(): unknown }, element: HTMLElement): void {
  const payload = outputItem.json() as ErrorPayload;
  ensureRendererStyles(element);

  const existingRoot = element.querySelector(':scope > .duckdb-root');
  if (existingRoot) {
    existingRoot.remove();
  }

  const root = document.createElement('div');
  root.className = 'duckdb-root duckdb-table-output';
  element.append(root);

  const card = document.createElement('div');
  card.className = 'duckdb-error-card';

  const header = document.createElement('div');
  header.className = 'duckdb-error-header';

  const icon = document.createElement('span');
  icon.className = 'duckdb-error-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '!';

  const title = document.createElement('span');
  title.className = 'duckdb-error-title';
  title.textContent = 'Execution failed';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'duckdb-error-copy-btn';
  copyButton.title = 'Copy error to clipboard';
  copyButton.setAttribute('aria-label', 'Copy error to clipboard');
  setCopyButtonIcon(copyButton, 'copy');
  copyButton.addEventListener('click', () => {
    void (async () => {
      copyButton.disabled = true;
      const copied = await copyTextToClipboard(payload.message);
      setCopyButtonIcon(copyButton, copied ? 'check' : 'copy');
      copyButton.title = copied ? 'Copied!' : 'Copy failed';
      window.setTimeout(() => {
        setCopyButtonIcon(copyButton, 'copy');
        copyButton.title = 'Copy error to clipboard';
        copyButton.disabled = false;
      }, 1500);
    })();
  });

  header.append(icon, title, copyButton);

  const message = document.createElement('div');
  message.className = 'duckdb-error-message';
  message.textContent = payload.message;

  card.append(header, message);

  if (payload.executionTimeMs !== undefined) {
    const timing = document.createElement('div');
    timing.className = 'duckdb-error-footer';
    timing.textContent = `${payload.executionTimeMs} ms`;
    card.append(timing);
  }

  root.append(card);
}

export const activate: ActivationFunction = () => {
  return {
    disposeOutputItem(id) {
      if (id) {
        outputViews.delete(id);
      } else {
        outputViews.clear();
      }
    },

    renderOutputItem(outputItem, element) {
      if (outputItem.mime === ERROR_MIME) {
        renderErrorOutput(outputItem, element);
        return;
      }

      const payload = outputItem.json() as QueryResultPayload;
      ensureRendererStyles(element);

      const existingRoot = element.querySelector(':scope > .duckdb-root');
      if (existingRoot) {
        existingRoot.remove();
      }

      const root = document.createElement('div');
      root.className = 'duckdb-root duckdb-table-output';
      element.append(root);

      if (!payload.columns?.length) {
        const ok = document.createElement('div');
        ok.className = 'duckdb-ok';
        ok.textContent = `Completed in ${payload.executionTimeMs} ms`;
        root.append(ok);
        return;
      }

      let rows = [...payload.rows];
      let sortCol: number | null = null;
      let sortDir: SortDir = null;
      let filter = '';
      const colKinds = payload.columns.map((_, i) => classifyColumn(rows, i));
      const colStyles = payload.columns.map((_, i) => styleForInferredKind(colKinds[i]));

      const card = document.createElement('div');
      card.className = 'duckdb-result-card';

      const scroll = document.createElement('div');
      scroll.className = 'duckdb-table-scroll';
      const table = document.createElement('table');
      table.className = 'duckdb-table';
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      const indexTh = document.createElement('th');
      indexTh.className = 'duckdb-row-num';
      indexTh.textContent = '#';
      headerRow.append(indexTh);

      const headerCells: HTMLTableCellElement[] = [];
      for (let i = 0; i < payload.columns.length; i++) {
        const th = document.createElement('th');
        th.className = 'duckdb-sortable';
        th.dataset.col = String(i);
        th.innerHTML = `<span class="duckdb-th-inner"><span class="duckdb-col-name">${payload.columns[i]}</span><span class="${colStyles[i].className}">${colStyles[i].label}</span></span><span class="duckdb-sort-icon">↕</span>`;
        headerCells.push(th);
        headerRow.append(th);
      }
      thead.append(headerRow);

      const tbody = document.createElement('tbody');
      const footer = document.createElement('div');
      footer.className = 'duckdb-footer';
      const footerLeft = document.createElement('span');
      const footerActions = document.createElement('div');
      footerActions.className = 'duckdb-footer-actions';

      const searchWrap = document.createElement('div');
      searchWrap.className = 'duckdb-footer-search';

      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.className = 'duckdb-search duckdb-hidden';
      searchInput.placeholder = 'Search in table…';
      searchInput.setAttribute('aria-label', 'Search in displayed data');
      searchInput.addEventListener('input', () => {
        filter = searchInput.value.trim();
        renderBody();
      });
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          searchInput.value = '';
          filter = '';
          searchInput.classList.add('duckdb-hidden');
          searchButton.classList.remove('duckdb-search-active');
          searchButton.title = 'Search in displayed data';
          renderBody();
          searchButton.focus();
        }
      });

      const searchButton = document.createElement('button');
      searchButton.type = 'button';
      searchButton.className = 'duckdb-search-btn';
      searchButton.title = 'Search in displayed data';
      searchButton.setAttribute('aria-label', 'Search in displayed data');
      searchButton.innerHTML =
        '<svg class="duckdb-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      searchButton.addEventListener('click', () => {
        const opening = searchInput.classList.contains('duckdb-hidden');
        searchInput.classList.toggle('duckdb-hidden', !opening);
        searchButton.classList.toggle('duckdb-search-active', opening);
        searchButton.title = opening ? 'Hide search' : 'Search in displayed data';
        if (opening) {
          searchInput.focus();
          searchInput.select();
        } else if (filter) {
          searchInput.value = '';
          filter = '';
          renderBody();
        }
      });

      searchWrap.append(searchInput, searchButton);
      footerActions.append(searchWrap);

      const footerRight = document.createElement('span');
      footerRight.className = 'duckdb-footer-time';

      const viewState: OutputViewState = {
        payload: { ...payload },
        footerLeft,
      };
      outputViews.set(outputItem.id, viewState);
      applyPayloadToView(viewState);

      function updateFooter(visibleCount: number): void {
        footerLeft.textContent = filter
          ? formatRowSummary(viewState.payload, visibleCount)
          : formatRowSummary(viewState.payload);
        footerRight.textContent = `${viewState.payload.executionTimeMs} ms`;
      }

      function updateSortHeaders(): void {
        for (let i = 0; i < headerCells.length; i++) {
          const th = headerCells[i];
          th.classList.remove('duckdb-sorted-asc', 'duckdb-sorted-desc');
          const icon = th.querySelector('.duckdb-sort-icon');
          if (icon) icon.textContent = '↕';
          if (sortCol === i && sortDir) {
            th.classList.add(sortDir === 'asc' ? 'duckdb-sorted-asc' : 'duckdb-sorted-desc');
            if (icon) icon.textContent = sortDir === 'asc' ? '↑' : '↓';
          }
        }
      }

      function renderBody(): void {
        tbody.replaceChildren();
        let visible = 0;

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          if (!rowMatchesFilter(row, filter)) continue;
          visible++;

          const tr = document.createElement('tr');
          const numTd = document.createElement('td');
          numTd.className = 'duckdb-row-num';
          numTd.textContent = String(rowIndex + 1);
          tr.append(numTd);

          for (let colIndex = 0; colIndex < payload.columns.length; colIndex++) {
            const td = document.createElement('td');
            td.innerHTML = renderCellHtml(row[colIndex], colKinds[colIndex]);
            tr.append(td);
          }
          tbody.append(tr);
        }

        if (visible === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = payload.columns.length + 1;
          td.className = 'duckdb-empty';
          td.textContent = filter ? 'No rows match your search.' : 'No rows returned.';
          tr.append(td);
          tbody.append(tr);
        }

        updateFooter(visible);
      }

      for (const th of headerCells) {
        th.addEventListener('click', () => {
          const col = Number(th.dataset.col);
          if (sortCol === col) {
            sortDir = sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc';
            if (!sortDir) sortCol = null;
          } else {
            sortCol = col;
            sortDir = 'asc';
          }
          if (sortDir) rows.sort((a, b) => (sortDir === 'asc' ? 1 : -1) * compareValues(a[col], b[col]));
          else rows = [...payload.rows];
          updateSortHeaders();
          renderBody();
        });
      }

      table.append(thead, tbody);
      scroll.append(table);
      footer.append(footerLeft, footerActions, footerRight);
      card.append(scroll, footer);
      root.append(card);
      renderBody();
    },
  };
};
