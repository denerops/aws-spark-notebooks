import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildQueryResultView,
  formatFooterRowLabel,
  renderCellHtml,
  type QueryResultPayload,
} from '../tableModel';

function payload(overrides: Partial<QueryResultPayload> = {}): QueryResultPayload {
  return {
    columns: ['id', 'name', 'active'],
    rows: [
      [1, 'alice', true],
      [2, 'bob', false],
      [null, 'carol', null],
    ],
    rowCount: 3,
    executionTimeMs: 42,
    truncated: false,
    ...overrides,
  };
}

describe('buildQueryResultView', () => {
  it('derives column name, kind, and type badge', () => {
    const view = buildQueryResultView(payload());

    assert.equal(view.hasTable, true);
    assert.equal(view.executionTimeMs, 42);
    assert.deepEqual(
      view.columns.map((col) => ({
        name: col.name,
        kind: col.kind,
        label: col.typeBadge.label,
        className: col.typeBadge.className,
      })),
      [
        {
          name: 'id',
          kind: 'number',
          label: 'double',
          className: 'duckdb-col-type duckdb-type-double',
        },
        {
          name: 'name',
          kind: 'string',
          label: 'varchar',
          className: 'duckdb-col-type duckdb-type-varchar',
        },
        {
          name: 'active',
          kind: 'boolean',
          label: 'boolean',
          className: 'duckdb-col-type duckdb-type-boolean',
        },
      ]
    );
  });

  it('marks timing-only payloads as having no table', () => {
    const view = buildQueryResultView(
      payload({ columns: [], rows: [], rowCount: 0 })
    );

    assert.equal(view.hasTable, false);
    assert.equal(view.columns.length, 0);
    assert.equal(view.footerRowLabel, '0 row(s)');
  });

  it('uses exact footer label when not truncated', () => {
    assert.equal(buildQueryResultView(payload()).footerRowLabel, '3 row(s)');
  });

  it('uses truncated footer label when truncated', () => {
    const view = buildQueryResultView(
      payload({ truncated: true, rowCount: 5 })
    );
    assert.equal(view.footerRowLabel, 'Showing 5+ rows');
  });

  it('uses filtered footer label when filteredVisible is set', () => {
    const view = buildQueryResultView(payload(), { filteredVisible: 1 });
    assert.equal(view.footerRowLabel, '1 of 3 rows shown');
  });
});

describe('formatFooterRowLabel', () => {
  it('prefers filtered count over truncation wording', () => {
    assert.equal(
      formatFooterRowLabel(payload({ truncated: true, rowCount: 5 }), 2),
      '2 of 3 rows shown'
    );
  });
});

describe('renderCellHtml', () => {
  it('renders null, boolean, number, and json cells', () => {
    assert.equal(renderCellHtml(null, 'null'), '<span class="duckdb-null">null</span>');
    assert.equal(
      renderCellHtml(true, 'boolean'),
      '<span class="duckdb-badge duckdb-badge-true">true</span>'
    );
    assert.equal(
      renderCellHtml(12, 'number'),
      '<span class="duckdb-cell duckdb-cell-num">12</span>'
    );
    assert.match(renderCellHtml({ a: 1 }, 'json'), /duckdb-json/);
  });
});
