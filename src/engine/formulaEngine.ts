import { CellFormat, EvaluatedCell, FormulaStepTrace, ModelSheet, ScenarioName } from '../types/finance';

export function colIndexToLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export function letterToColIndex(letters: string): number {
  let col = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    col = col * 26 + (upper.charCodeAt(i) - 64);
  }
  return col - 1;
}

export function parseCellRef(ref: string): { col: number; row: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!match) return null;
  return {
    col: letterToColIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}

export function expandRange(startRef: string, endRef: string): string[] {
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);
  if (!start || !end) return [];
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const refs: string[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      refs.push(`${colIndexToLetter(c)}${r + 1}`);
    }
  }
  return refs;
}

export function formatCellValue(value: number | string | null, format: CellFormat = 'number'): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '#NUM!';

  switch (format) {
    case 'currency': {
      const abs = Math.abs(value);
      const formatted = abs.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      return value < 0 ? `($${formatted})` : `$${formatted}`;
    }
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'integer':
      return Math.round(value).toLocaleString('en-US');
    case 'number':
      return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    case 'text':
    default:
      return String(value);
  }
}

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'SHEET_CELL'
  | 'CELL'
  | 'RANGE'
  | 'SHEET_RANGE'
  | 'IDENT'
  | 'OP'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Quoted string
    if (ch === '"') {
      let str = '';
      i++;
      while (i < expr.length && expr[i] !== '"') {
        str += expr[i++];
      }
      i++; // closing quote
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    // Cross-sheet reference with single quotes: 'Sheet Name'!A1 or 'Sheet Name'!A1:B5
    if (ch === "'") {
      const endQuote = expr.indexOf("'", i + 1);
      if (endQuote !== -1 && expr[endQuote + 1] === '!') {
        const sheetName = expr.slice(i + 1, endQuote);
        const rest = expr.slice(endQuote + 2);
        const rangeMatch = /^([A-Za-z]+\d+:[A-Za-z]+\d+)/.exec(rest);
        if (rangeMatch) {
          tokens.push({ type: 'SHEET_RANGE', value: `${sheetName}!${rangeMatch[1]}` });
          i = endQuote + 2 + rangeMatch[1].length;
          continue;
        }
        const cellMatch = /^([A-Za-z]+\d+)/.exec(rest);
        if (cellMatch) {
          tokens.push({ type: 'SHEET_CELL', value: `${sheetName}!${cellMatch[1]}` });
          i = endQuote + 2 + cellMatch[1].length;
          continue;
        }
      }
    }

    // Two-char comparison operators
    const twoChar = expr.slice(i, i + 2);
    if (twoChar === '>=' || twoChar === '<=' || twoChar === '<>') {
      tokens.push({ type: 'OP', value: twoChar });
      i += 2;
      continue;
    }

    if ('+-*/^=<>'.includes(ch)) {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i++;
      continue;
    }

    // Number literal
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] ?? ''))) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Identifier, cell ref, or range
    if (/[A-Za-z_]/.test(ch)) {
      const slice = expr.slice(i);
      const sheetRangeMatch = /^([A-Za-z_][A-Za-z0-9_ ]*)!([A-Za-z]+\d+:[A-Za-z]+\d+)/.exec(slice);
      if (sheetRangeMatch) {
        tokens.push({ type: 'SHEET_RANGE', value: `${sheetRangeMatch[1]}!${sheetRangeMatch[2]}` });
        i += sheetRangeMatch[0].length;
        continue;
      }

      const sheetCellMatch = /^([A-Za-z_][A-Za-z0-9_ ]*)!([A-Za-z]+\d+)/.exec(slice);
      if (sheetCellMatch) {
        tokens.push({ type: 'SHEET_CELL', value: `${sheetCellMatch[1]}!${sheetCellMatch[2]}` });
        i += sheetCellMatch[0].length;
        continue;
      }

      const rangeMatch = /^([A-Za-z]+\d+:[A-Za-z]+\d+)/.exec(slice);
      if (rangeMatch) {
        tokens.push({ type: 'RANGE', value: rangeMatch[1] });
        i += rangeMatch[1].length;
        continue;
      }

      const cellMatch = /^([A-Za-z]+\d+)(?![A-Za-z0-9_(])/.exec(slice);
      if (cellMatch) {
        tokens.push({ type: 'CELL', value: cellMatch[1].toUpperCase() });
        i += cellMatch[1].length;
        continue;
      }

      const identMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(slice);
      if (identMatch) {
        tokens.push({ type: 'IDENT', value: identMatch[1].toUpperCase() });
        i += identMatch[1].length;
        continue;
      }
    }

    throw new Error(`Unexpected token "${ch}"`);
  }

  return tokens;
}

function calculateIRR(values: number[]): number {
  if (values.length < 2) return 0;
  let guess = 0.1;
  for (let iter = 0; iter < 60; iter++) {
    let npv = 0;
    let dNpv = 0;
    for (let t = 0; t < values.length; t++) {
      const denom = Math.pow(1 + guess, t);
      npv += values[t] / denom;
      if (t > 0) {
        dNpv -= (t * values[t]) / Math.pow(1 + guess, t + 1);
      }
    }
    if (Math.abs(npv) < 1e-6) return guess;
    if (Math.abs(dNpv) < 1e-9) break;
    const next = guess - npv / dNpv;
    if (!Number.isFinite(next) || next <= -0.99) break;
    guess = next;
  }
  return guess;
}

export function evaluateWorkbook(
  sheets: ModelSheet[],
  scenario: ScenarioName = 'Base',
): Record<string, Record<string, EvaluatedCell>> {
  const sheetById = new Map<string, ModelSheet>();
  const sheetByName = new Map<string, ModelSheet>();
  for (const s of sheets) {
    sheetById.set(s.id, s);
    sheetByName.set(s.name.toLowerCase(), s);
  }

  const cache = new Map<string, EvaluatedCell>();
  const visiting = new Set<string>();

  const scenarioFactor = (sheetId: string, cellKey: string): number => {
    if (scenario === 'Base') return 1;
    // Apply sensitivity drivers to Revenue Drivers or growth/price input rows
    if (sheetId === 'revenue-drivers' && /^[B-M](2|3|4|6)$/.test(cellKey)) {
      return scenario === 'Upside' ? 1.15 : 0.88;
    }
    if (sheetId === 'opex-headcount' && /^[B-M](2|3)$/.test(cellKey)) {
      return scenario === 'Upside' ? 1.04 : 0.94;
    }
    return 1;
  };

  function resolveSheet(nameOrId: string, fallbackSheetId: string): ModelSheet | undefined {
    const clean = nameOrId.trim().toLowerCase();
    return sheetByName.get(clean) || sheetById.get(clean) || sheetById.get(fallbackSheetId);
  }

  function evalCell(sheetId: string, cellKey: string): EvaluatedCell {
    const normalizedKey = cellKey.toUpperCase();
    const cacheKey = `${sheetId}::${normalizedKey}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;

    const sheet = sheetById.get(sheetId);
    const rawCell = sheet?.cells[normalizedKey];

    if (!rawCell) {
      const empty: EvaluatedCell = {
        value: 0,
        formatted: '',
        isFormula: false,
        steps: [],
        precedents: [],
      };
      cache.set(cacheKey, empty);
      return empty;
    }

    if (rawCell.isSensitive && rawCell.raw === '[REDACTED]') {
      const redacted: EvaluatedCell = {
        value: '[REDACTED]',
        formatted: '[REDACTED]',
        isFormula: false,
        steps: [],
        precedents: [],
      };
      cache.set(cacheKey, redacted);
      return redacted;
    }

    const raw = rawCell.raw.trim();
    if (!raw.startsWith('=')) {
      const num = Number(raw.replace(/[$,%]/g, ''));
      const isNumeric = raw !== '' && !Number.isNaN(num) && !/[A-Za-z]/.test(raw);
      const val = isNumeric ? num * scenarioFactor(sheetId, normalizedKey) : raw;
      const evaluated: EvaluatedCell = {
        value: val,
        formatted: isNumeric
          ? formatCellValue(val as number, rawCell.format ?? 'number')
          : raw,
        isFormula: false,
        steps: [],
        precedents: [],
      };
      cache.set(cacheKey, evaluated);
      return evaluated;
    }

    if (visiting.has(cacheKey)) {
      return {
        value: null,
        error: '#CIRC!',
        formatted: '#CIRC!',
        isFormula: true,
        steps: [{ step: 1, expression: raw, evaluated: '#CIRC!', detail: 'Circular reference detected' }],
        precedents: [],
      };
    }

    visiting.add(cacheKey);
    const steps: FormulaStepTrace[] = [];
    const precedents = new Set<string>();

    try {
      const tokens = tokenize(raw.slice(1));
      let pos = 0;

      const peek = () => tokens[pos];
      const consume = () => tokens[pos++];

      const toNumber = (v: number | string | boolean | number[]): number => {
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (Array.isArray(v)) return v[0] ?? 0;
        const parsed = Number(v);
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      const flattenNumbers = (args: Array<number | string | boolean | number[]>): number[] => {
        const out: number[] = [];
        for (const a of args) {
          if (Array.isArray(a)) out.push(...a);
          else if (typeof a === 'number') out.push(a);
          else if (typeof a === 'boolean') out.push(a ? 1 : 0);
          else if (typeof a === 'string' && a !== '' && !Number.isNaN(Number(a))) out.push(Number(a));
        }
        return out;
      };

      const evalRangeValues = (targetSheetId: string, rangeStr: string): number[] => {
        const [startRef, endRef] = rangeStr.split(':');
        const refs = expandRange(startRef, endRef);
        const vals: number[] = [];
        for (const r of refs) {
          precedents.add(`${targetSheetId}!${r}`);
          const c = evalCell(targetSheetId, r);
          if (c.error) throw new Error(c.error);
          if (typeof c.value === 'number') vals.push(c.value);
        }
        return vals;
      };

      type ExprVal = number | string | boolean | number[];

      const parseComparison = (): ExprVal => {
        let left = parseAdditive();
        while (peek()?.type === 'OP' && ['=', '<>', '>', '<', '>=', '<='].includes(peek()!.value)) {
          const op = consume().value;
          const right = parseAdditive();
          const lNum = typeof left === 'number' ? left : Number(left);
          const rNum = typeof right === 'number' ? right : Number(right);
          const bothNum = !Number.isNaN(lNum) && !Number.isNaN(rNum);
          let res = false;
          if (op === '=') res = bothNum ? Math.abs(lNum - rNum) < 1e-9 : String(left) === String(right);
          else if (op === '<>') res = bothNum ? Math.abs(lNum - rNum) >= 1e-9 : String(left) !== String(right);
          else if (op === '>') res = lNum > rNum;
          else if (op === '<') res = lNum < rNum;
          else if (op === '>=') res = lNum >= rNum;
          else if (op === '<=') res = lNum <= rNum;
          steps.push({
            step: steps.length + 1,
            expression: `${String(left)} ${op} ${String(right)}`,
            evaluated: String(res),
            detail: 'Logical comparison',
          });
          left = res;
        }
        return left;
      };

      const parseAdditive = (): ExprVal => {
        let left = parseMultiplicative();
        while (peek()?.type === 'OP' && (peek()!.value === '+' || peek()!.value === '-')) {
          const op = consume().value;
          const right = parseMultiplicative();
          const l = toNumber(left);
          const r = toNumber(right);
          const res = op === '+' ? l + r : l - r;
          steps.push({
            step: steps.length + 1,
            expression: `${l.toFixed(2)} ${op} ${r.toFixed(2)}`,
            evaluated: res.toFixed(2),
            detail: op === '+' ? 'Addition step' : 'Subtraction step',
          });
          left = res;
        }
        return left;
      };

      const parseMultiplicative = (): ExprVal => {
        let left = parsePower();
        while (peek()?.type === 'OP' && (peek()!.value === '*' || peek()!.value === '/')) {
          const op = consume().value;
          const right = parsePower();
          const l = toNumber(left);
          const r = toNumber(right);
          if (op === '/' && Math.abs(r) < 1e-12) {
            throw new Error('#DIV/0!');
          }
          const res = op === '*' ? l * r : l / r;
          steps.push({
            step: steps.length + 1,
            expression: `${l.toFixed(2)} ${op} ${r.toFixed(2)}`,
            evaluated: res.toFixed(2),
            detail: op === '*' ? 'Multiplication step' : 'Division step',
          });
          left = res;
        }
        return left;
      };

      const parsePower = (): ExprVal => {
        let left = parseUnary();
        while (peek()?.type === 'OP' && peek()!.value === '^') {
          consume();
          const right = parseUnary();
          const l = toNumber(left);
          const r = toNumber(right);
          const res = Math.pow(l, r);
          steps.push({
            step: steps.length + 1,
            expression: `${l.toFixed(2)} ^ ${r.toFixed(2)}`,
            evaluated: res.toFixed(2),
            detail: 'Exponentiation step',
          });
          left = res;
        }
        return left;
      };

      const parseUnary = (): ExprVal => {
        if (peek()?.type === 'OP' && (peek()!.value === '-' || peek()!.value === '+')) {
          const op = consume().value;
          const val = toNumber(parseUnary());
          return op === '-' ? -val : val;
        }
        return parsePrimary();
      };

      const parsePrimary = (): ExprVal => {
        const tok = peek();
        if (!tok) return 0;

        if (tok.type === 'NUMBER') {
          consume();
          return Number(tok.value);
        }

        if (tok.type === 'STRING') {
          consume();
          return tok.value;
        }

        if (tok.type === 'CELL') {
          consume();
          precedents.add(`${sheetId}!${tok.value}`);
          const c = evalCell(sheetId, tok.value);
          if (c.error) throw new Error(c.error);
          const val = typeof c.value === 'number' ? c.value : toNumber(c.value ?? 0);
          steps.push({
            step: steps.length + 1,
            expression: tok.value,
            evaluated: formatCellValue(val, rawCell.format ?? 'number'),
            detail: `Read cell ${tok.value}`,
          });
          return val;
        }

        if (tok.type === 'SHEET_CELL') {
          consume();
          const [sName, cRef] = tok.value.split('!');
          const targetSheet = resolveSheet(sName, sheetId);
          if (!targetSheet) throw new Error('#REF!');
          precedents.add(`${targetSheet.id}!${cRef.toUpperCase()}`);
          const c = evalCell(targetSheet.id, cRef.toUpperCase());
          if (c.error) throw new Error(c.error);
          const val = typeof c.value === 'number' ? c.value : toNumber(c.value ?? 0);
          steps.push({
            step: steps.length + 1,
            expression: `${targetSheet.name}!${cRef.toUpperCase()}`,
            evaluated: formatCellValue(val, rawCell.format ?? 'number'),
            detail: `Cross-sheet reference from ${targetSheet.name}`,
          });
          return val;
        }

        if (tok.type === 'RANGE') {
          consume();
          const vals = evalRangeValues(sheetId, tok.value);
          steps.push({
            step: steps.length + 1,
            expression: tok.value,
            evaluated: `[${vals.length} cells]`,
            detail: `Expand range ${tok.value}`,
          });
          return vals;
        }

        if (tok.type === 'SHEET_RANGE') {
          consume();
          const [sName, rangeStr] = tok.value.split('!');
          const targetSheet = resolveSheet(sName, sheetId);
          if (!targetSheet) throw new Error('#REF!');
          const vals = evalRangeValues(targetSheet.id, rangeStr);
          steps.push({
            step: steps.length + 1,
            expression: `${targetSheet.name}!${rangeStr}`,
            evaluated: `[${vals.length} cells]`,
            detail: `Cross-sheet range from ${targetSheet.name}`,
          });
          return vals;
        }

        if (tok.type === 'IDENT') {
          const fnName = consume().value;
          if (peek()?.type === 'LPAREN') {
            consume(); // '('
            const args: ExprVal[] = [];
            if (peek()?.type !== 'RPAREN') {
              args.push(parseComparison());
              while (peek()?.type === 'COMMA') {
                consume();
                args.push(parseComparison());
              }
            }
            if (peek()?.type === 'RPAREN') consume();

            let fnResult: ExprVal = 0;
            const nums = flattenNumbers(args);

            switch (fnName) {
              case 'SUM':
                fnResult = nums.reduce((a, b) => a + b, 0);
                break;
              case 'AVERAGE':
              case 'AVG':
                fnResult = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
                break;
              case 'MIN':
                fnResult = nums.length ? Math.min(...nums) : 0;
                break;
              case 'MAX':
                fnResult = nums.length ? Math.max(...nums) : 0;
                break;
              case 'COUNT':
                fnResult = nums.length;
                break;
              case 'ABS':
                fnResult = Math.abs(toNumber(args[0] ?? 0));
                break;
              case 'SQRT':
                fnResult = Math.sqrt(Math.max(0, toNumber(args[0] ?? 0)));
                break;
              case 'POWER':
                fnResult = Math.pow(toNumber(args[0] ?? 0), toNumber(args[1] ?? 1));
                break;
              case 'ROUND': {
                const v = toNumber(args[0] ?? 0);
                const digits = Math.round(toNumber(args[1] ?? 0));
                const factor = Math.pow(10, digits);
                fnResult = Math.round(v * factor) / factor;
                break;
              }
              case 'IF': {
                const cond = Boolean(args[0]);
                fnResult = cond ? (args[1] ?? 0) : (args[2] ?? 0);
                break;
              }
              case 'AND':
                fnResult = args.every((a) => Boolean(a));
                break;
              case 'OR':
                fnResult = args.some((a) => Boolean(a));
                break;
              case 'NPV': {
                const rate = toNumber(args[0] ?? 0);
                const cfs = flattenNumbers(args.slice(1));
                fnResult = cfs.reduce((acc, cf, idx) => acc + cf / Math.pow(1 + rate, idx + 1), 0);
                break;
              }
              case 'IRR': {
                fnResult = calculateIRR(nums);
                break;
              }
              default:
                throw new Error('#NAME?');
            }

            steps.push({
              step: steps.length + 1,
              expression: `${fnName}(...)`,
              evaluated: typeof fnResult === 'number' ? fnResult.toFixed(2) : String(fnResult),
              detail: `Execute ${fnName} function`,
            });
            return fnResult;
          }
          if (fnName === 'TRUE') return true;
          if (fnName === 'FALSE') return false;
          throw new Error('#NAME?');
        }

        if (tok.type === 'LPAREN') {
          consume();
          const inner = parseComparison();
          if (peek()?.type === 'RPAREN') consume();
          return inner;
        }

        throw new Error('#VALUE!');
      };

      const result = parseComparison();
      const finalVal = typeof result === 'boolean' ? (result ? 1 : 0) : Array.isArray(result) ? result[0] ?? 0 : result;
      const evaluated: EvaluatedCell = {
        value: finalVal,
        formatted: typeof finalVal === 'number' ? formatCellValue(finalVal, rawCell.format ?? 'number') : String(finalVal),
        isFormula: true,
        steps,
        precedents: Array.from(precedents),
      };
      cache.set(cacheKey, evaluated);
      visiting.delete(cacheKey);
      return evaluated;
    } catch (err) {
      visiting.delete(cacheKey);
      const errCode = err instanceof Error && err.message.startsWith('#') ? err.message : '#ERROR!';
      const failed: EvaluatedCell = {
        value: null,
        error: errCode,
        formatted: errCode,
        isFormula: true,
        steps: [
          ...steps,
          { step: steps.length + 1, expression: raw, evaluated: errCode, detail: 'Evaluation halted' },
        ],
        precedents: Array.from(precedents),
      };
      cache.set(cacheKey, failed);
      return failed;
    }
  }

  const output: Record<string, Record<string, EvaluatedCell>> = {};
  for (const sheet of sheets) {
    output[sheet.id] = {};
    for (const key of Object.keys(sheet.cells)) {
      output[sheet.id][key] = evalCell(sheet.id, key);
    }
  }
  return output;
}
