// A faster drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for {text, header}, but in a fraction of the CPU time.
//
// Design: one pass, left to right. Where csv-reader walks one character at a time
// and builds each field a character at a time, this reader scans with indexOf and
// builds fields with slice, so the common work runs in V8's C++ string routines:
//   - a record whose first physical line holds no quote and no stray CR is taken
//     whole: one split(',') gives its fields;
//   - an unquoted field is the slice up to the next comma or line break, with lone
//     CRs (stray_cr) cut out of the slice;
//   - a quoted field is found by scanning for quotes ("" is one quote), and its
//     content is taken as one slice unless it holds a line break or a doubled
//     quote, in which case the breaks and doublings are folded in one pass.
// All error records keep csv-reader's shape and order: {code, line, row}, line the
// 1-based line the record starts on, row its index in rows (null for the header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null: the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, onto `value`. A CR not followed by
  // LF is dropped (stray_cr); the field ends at a comma, a line break or the end
  // of the text. `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    if (pos >= len) return { value, ended: END, added };
    const ci = text.indexOf(',', pos);
    const ni = text.indexOf('\n', pos);
    let end;
    let kind;
    if (ci === -1 && ni === -1) {
      end = len;
      kind = END;
    } else if (ni === -1 || (ci !== -1 && ci < ni)) {
      end = ci;
      kind = COMMA;
    } else {
      end = ni;
      kind = LINE_BREAK;
    }
    // A CR right before the line break is the CRLF's own, not part of the field.
    let cend = end;
    if (kind === LINE_BREAK && cend > pos && text.charCodeAt(cend - 1) === 13) cend -= 1;
    if (cend > pos) {
      const seg = text.slice(pos, cend);
      const ri = seg.indexOf('\r');
      if (ri === -1) {
        value = value === '' ? seg : value + seg;
        added += seg.length;
      } else {
        // Lone CRs inside the field: drop each (stray_cr) and keep the rest.
        let k = 0;
        let r = ri;
        while (true) {
          error('stray_cr');
          value += seg.slice(k, r);
          added += r - k;
          k = r + 1;
          r = seg.indexOf('\r', k);
          if (r === -1) {
            value += seg.slice(k);
            added += seg.length - k;
            break;
          }
        }
      }
    }
    if (kind === COMMA) {
      pos = end + 1;
      return { value, ended: COMMA, added };
    }
    if (kind === LINE_BREAK) {
      pos = end + 1;
      line += 1;
      return { value, ended: LINE_BREAK, added };
    }
    pos = len;
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote: the next quote that is not doubled.
    let cur = pos + 1;
    let q;
    while (true) {
      q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        cur = q + 2;
        continue;
      }
      break;
    }
    const raw = text.slice(open + 1, q);
    let value;
    if (raw.indexOf('\r') === -1 && raw.indexOf('\n') === -1) {
      // No line break inside: only doubled quotes to fold.
      value = raw.indexOf('"') === -1 ? raw : raw.split('""').join('"');
    } else {
      // Fold line breaks (CRLF and lone CR each read as LF) and doubled quotes.
      let out = '';
      let k = 0;
      let lines = 0;
      while (true) {
        const ri = raw.indexOf('\r', k);
        const ni = raw.indexOf('\n', k);
        const qi = raw.indexOf('"', k);
        let m = -1;
        let kind = -1;
        if (ri !== -1) {
          m = ri;
          kind = 0;
        }
        if (ni !== -1 && (m === -1 || ni < m)) {
          m = ni;
          kind = 1;
        }
        if (qi !== -1 && (m === -1 || qi < m)) {
          m = qi;
          kind = 2;
        }
        if (m === -1) {
          out += raw.slice(k);
          break;
        }
        out += raw.slice(k, m);
        if (kind === 2) {
          out += '"';
          k = m + 2;
        } else if (kind === 1) {
          out += '\n';
          lines += 1;
          k = m + 1;
        } else {
          out += '\n';
          lines += 1;
          k = m + 1;
          if (raw.charCodeAt(k) === 10) k += 1;
        }
      }
      value = out;
      line += lines;
    }
    pos = q + 1;
    if (pos >= len) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record whose first physical line holds no quote and no stray
    // CR is one split(',') away; no quoted field can reach past its line break.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    let contentEnd = lineEnd;
    if (nl !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    if (contentEnd > pos) {
      const seg = text.slice(pos, contentEnd);
      if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
        const fields = seg.split(',');
        if (!(fields.length === 1 && fields[0] === '')) {
          if (width < 0) width = fields.length;
          if (header && columns === null) {
            columns = fields;
          } else {
            if (fields.length < width) {
              errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
              while (fields.length < width) fields.push('');
            } else if (fields.length > width) {
              errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
            }
            rows.push(fields);
          }
        }
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
        continue;
      }
    }

    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
