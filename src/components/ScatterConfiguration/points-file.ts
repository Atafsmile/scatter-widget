import * as XLSX from 'xlsx';
import { ScatterOverlayPoint } from '../../iosense-sdk/types';

// Parses + validates a benchmark/zone points file per the design's "Excel file
// upload check points" spec:
//   - supported formats: .csv / .xlsx / .xls
//   - at least two columns (first two are X and Y; headers may have any name)
//   - values must be numeric (any length, integers or decimals)
//   - trailing empty rows are ignored
//   - on success the points auto-populate the X/Y axes fields

export type PointsFileResult =
  | { ok: true; points: ScatterOverlayPoint[] }
  | { ok: false; error: string };

const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

function isNumericCell(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.trim() !== '' && Number.isFinite(Number(v.trim()));
  return false;
}

function isEmptyCell(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

// "Download Template" (Bulk Upload Template) — a minimal .xlsx with the X/Y header
// row and sample numeric rows, so the round trip through parsePointsFile validates.
export function downloadPointsTemplate(fileName: string): void {
  const sheet = XLSX.utils.aoa_to_sheet([['X', 'Y'], [20, 40], [30, 50], [40, 60]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Template');
  XLSX.writeFile(workbook, fileName);
}

export async function parsePointsFile(file: File): Promise<PointsFileResult> {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return { ok: false, error: 'The file format is unsupported. Supported formats: .csv, .xlsx, .xls.' };
  }

  let rows: unknown[][];
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return { ok: false, error: 'The uploaded file contains no valid data rows.' };
    rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  } catch {
    return { ok: false, error: 'The file format is unsupported. Supported formats: .csv, .xlsx, .xls.' };
  }

  if (rows.length === 0) return { ok: false, error: 'The uploaded file contains no valid data rows.' };

  if (!rows.some((row) => row.length >= 2)) {
    return { ok: false, error: 'The file contains fewer than the required number of columns (X and Y).' };
  }

  // Headers can have any name — skip the first row only when it isn't itself numeric
  // data (a file may legitimately start with values and no header at all).
  const first = rows[0];
  const dataRows = isNumericCell(first?.[0]) && isNumericCell(first?.[1]) ? rows : rows.slice(1);

  if (dataRows.length === 0) return { ok: false, error: 'The uploaded file contains no valid data rows.' };

  const points: ScatterOverlayPoint[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const [x, y] = dataRows[i];
    if (isEmptyCell(x) && isEmptyCell(y)) continue; // stray blank row — ignore like trailing ones
    if (isEmptyCell(x) || isEmptyCell(y)) {
      return { ok: false, error: `Required columns are empty (row ${i + 2}).` };
    }
    if (!isNumericCell(x) || !isNumericCell(y)) {
      return { ok: false, error: `Required columns contain non-numeric values (row ${i + 2}).` };
    }
    points.push({ x: Number(x), y: Number(y) });
  }

  if (points.length === 0) return { ok: false, error: 'The uploaded file contains no valid data rows.' };

  return { ok: true, points };
}
