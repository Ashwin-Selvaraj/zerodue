/** Reads delimited text (a bank's CSV export) into rows of cells. */

const DELIMITERS = [',', ';', '\t', '|'] as const;

/** Picks the delimiter that splits the first lines into the same number of cells, outside quotes. */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 15);
  let best = ',';
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => splitLine(line, delimiter).length);
    const wide = counts.filter((c) => c > 1);
    if (wide.length === 0) continue;
    // reward the delimiter that splits most lines, and splits them the same way
    const common = Math.max(...wide.map((c) => wide.filter((d) => d === c).length));
    const score = common * 1000 + Math.max(...wide);
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // drop a byte-order mark
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
    row = [];
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  endRow();
  return rows;
}
