// fast-csv-reader: a faster drop-in for make.fun's own csv-reader 1.0.0.
//
// Same answer as csv-reader 1.0.0 on every input {text, header} -> {columns, rows, errors}.
// The reference reads one character at a time and builds every field one character at a
// time. This reader instead works record by record, line by line:
//
//   * Tier 1 (the common case): a record lives on one line, so the line is sliced out
//     once (a SlicedString: no copy) and its fields are cut with indexOf/split, which
//     run in V8's native string code instead of a JS character loop. A line with no
//     quote at all is split in one native call. A line with quotes is cut field by
//     field with indexOf('"') / indexOf(','), still without ever concatenating a
//     character at a time. A stray CR or a quote that does not close on the line
//     sends the record to Tier 2.
//   * Tier 2 (rare records): a faithful port of the reference's state machine, but
//     fields are accumulated as slices joined once, never character by character.
//     It handles multiline quoted fields, stray CRs, quote junk and unterminated
//     quotes exactly as the reference does.
//
// No state is kept from one run() call to the next; nothing is cached between cases.
// Pure: no clock, no randomness, no locale.

/** Field endings inside the slow parser: 0 comma, 1 line break, 2 end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1; // a U+FEFF at the very start is dropped

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  /** The segments in `parts` plus text[seg..end) joined once. */
  function assemble(parts, seg, end) {
    if (parts === null) return text.slice(seg, end);
    parts.push(text.slice(seg, end));
    return parts.join('');
  }

  // Reads unquoted characters from pos up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). `init` is a value already held ('' normally,
  // '"' for the re-read after an unterminated quote); `added` counts only the
  // characters kept here, as the reference counts them.
  function readUnquotedSlow(init) {
    let parts = init !== '' ? [init] : null;
    let seg = pos;
    let added = 0;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        const value = assemble(parts, seg, pos);
        pos += 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        const value = assemble(parts, seg, pos);
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          const value = assemble(parts, seg, pos);
          pos += 2;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        err('stray_cr');
        if (parts === null) parts = [];
        parts.push(text.slice(seg, pos));
        pos += 1;
        seg = pos;
        continue;
      }
      added += 1;
      pos += 1;
    }
    return { value: assemble(parts, seg, pos), ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuotedSlow() {
    const open = pos;
    const openLine = line;
    let parts = null;
    let seg = pos + 1;
    pos += 1;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(seg, pos), '"');
          pos += 2;
          seg = pos;
          continue;
        }
        const value = assemble(parts, seg, pos);
        pos += 1;
        if (pos >= n) return { value, ended: END };
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          return { value, ended: COMMA };
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          return { value, ended: LINE_BREAK };
        }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          return { value, ended: LINE_BREAK };
        }
        // What follows the closing quote is appended as it stands, up to the next
        // comma or line break.
        const junk = readUnquotedSlow(value);
        if (junk.added > 0) err('quote_junk');
        return junk;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(seg, pos), '\n');
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        seg = pos;
        continue;
      }
      if (c === 10) line += 1;
      pos += 1;
    }
    // The quote never closes: it is a literal character, and the text after it is
    // read again as unquoted.
    pos = open + 1;
    line = openLine;
    err('unterminated_quote');
    return readUnquotedSlow('"');
  }

  // Reads one record the slow way, from pos. Returns its fields and whether its
  // last field was quoted (the reference skips a record that is one empty unquoted
  // field: a line that held only stray CRs).
  function parseRecordSlow() {
    const fields = [];
    let lastQuoted = false;
    let field;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      field = lastQuoted ? readQuotedSlow() : readUnquotedSlow('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    return { fields, lastQuoted };
  }

  // Reads one record from a single line `s` (no stray CR, no line break inside it).
  // Returns {fields, lastQuoted}, or null when a quoted field does not close on this
  // line: the record spans lines, or its quote never closes, and the slow parser
  // must take it. Field errors found here are pushed onto `errors`; the caller
  // truncates them back if this returns null.
  function parseLineQuoted(s) {
    const L = s.length;
    const fields = [];
    let i = 0;
    let lastQuoted = false;
    for (;;) {
      if (s.charCodeAt(i) === 34) {
        let start = i + 1;
        let parts = null;
        let value;
        for (;;) {
          const q = s.indexOf('"', start);
          if (q === -1) return null;
          if (s.charCodeAt(q + 1) === 34) {
            if (parts === null) parts = [];
            parts.push(s.slice(start, q), '"');
            start = q + 2;
            continue;
          }
          value = parts === null ? s.slice(start, q) : (parts.push(s.slice(start, q)), parts.join(''));
          i = q + 1;
          break;
        }
        if (i >= L) {
          fields.push(value);
          lastQuoted = true;
          return { fields, lastQuoted };
        }
        const c = s.charCodeAt(i);
        if (c === 44) {
          fields.push(value);
          lastQuoted = true;
          i += 1;
          continue;
        }
        // Junk after the closing quote, up to the next comma or the line's end.
        const ci = s.indexOf(',', i);
        const jend = ci === -1 ? L : ci;
        if (jend > i) {
          value += s.slice(i, jend);
          err('quote_junk');
        }
        fields.push(value);
        lastQuoted = true;
        if (ci === -1) return { fields, lastQuoted };
        i = ci + 1;
        continue;
      }
      const ci = s.indexOf(',', i);
      const fend = ci === -1 ? L : ci;
      fields.push(s.slice(i, fend));
      lastQuoted = false;
      if (ci === -1) return { fields, lastQuoted };
      i = ci + 1;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
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
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const recStart = pos;
    const recLine = line;

    // Tier 1: try the record as one line. The line is a slice (no copy, and
    // every indexOf on it is bounded by the line: a search for a rare CR can
    // never run away down the rest of the text); a line with no quote is
    // split in one native call, a line with quotes is cut field by field.
    // A stray CR or an unclosed quote sends the record to Tier 2.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    let le = lineEnd;
    if (nl !== -1 && le > pos && text.charCodeAt(le - 1) === 13) le -= 1; // CRLF
    const lineStr = text.slice(pos, le);

    let fields = null;
    let lastQuoted = false;
    let tier1 = false;
    if (lineStr.indexOf('\r') === -1) {
      if (lineStr.indexOf('"') === -1) {
        fields = lineStr.split(',');
        tier1 = true;
      } else {
        const errMark = errors.length;
        const r = parseLineQuoted(lineStr);
        if (r !== null) {
          fields = r.fields;
          lastQuoted = r.lastQuoted;
          tier1 = true;
        } else {
          errors.length = errMark;
        }
      }
    }

    if (tier1) {
      pos = nl === -1 ? n : nl + 1;
      if (nl !== -1) line += 1;
    } else {
      pos = recStart;
      line = recLine;
      const r = parseRecordSlow();
      fields = r.fields;
      lastQuoted = r.lastQuoted;
    }

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

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
