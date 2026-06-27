import type { CellKind } from './tableModel';

export interface ColumnTypeStyle {
  label: string;
  className: string;
}

function typeSlug(typeName: string): string {
  return typeName
    .toUpperCase()
    .replace(/\(.*$/, '')
    .split('<')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function styleForTypeName(typeName: string): ColumnTypeStyle {
  const label = typeName.toUpperCase();
  return {
    label,
    className: `duckdb-type-${typeSlug(typeName) || 'unknown'}`,
  };
}

export function styleForInferredKind(kind: CellKind): ColumnTypeStyle {
  switch (kind) {
    case 'boolean':
      return styleForTypeName('BOOLEAN');
    case 'number':
      return styleForTypeName('DOUBLE');
    case 'json':
      return styleForTypeName('JSON');
    case 'null':
      return styleForTypeName('UNKNOWN');
    default:
      return styleForTypeName('VARCHAR');
  }
}
