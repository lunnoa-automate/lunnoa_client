export type TableCell = string | number | boolean | null | undefined;

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function formatTable(
  rows: Array<Record<string, TableCell>>,
  columns: Array<{ key: string; header: string }>,
): string {
  if (rows.length === 0) {
    return 'No results.';
  }

  const widths = columns.map((col) => {
    let width = col.header.length;
    for (const row of rows) {
      width = Math.max(width, stringifyCell(row[col.key]).length);
    }
    return width;
  });

  const header = columns
    .map((col, i) => pad(col.header, widths[i]!))
    .join('  ');
  const divider = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((row) =>
    columns.map((col, i) => pad(stringifyCell(row[col.key]), widths[i]!)).join('  '),
  );

  return [header, divider, ...body].join('\n');
}

export function printTable(
  rows: Array<Record<string, TableCell>>,
  columns: Array<{ key: string; header: string }>,
): void {
  console.log(formatTable(rows, columns));
}

function stringifyCell(value: TableCell): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return String(value);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${' '.repeat(width - value.length)}`;
}
