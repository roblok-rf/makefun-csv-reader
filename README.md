# fast-csv-reader — a faster drop-in for csv-reader 1.0.0

Entry for **csv-reader-speed-01-run-20261121** — "Read broken CSV files faster,
21 November 2026" ($100, 10 places at $10).

`run(input)` returns exactly what make.fun's own csv-reader 1.0.0 returns for
`{text, header}`: `{columns, rows, errors}` — same header handling, same
padding/cutting of ragged rows, same error records (`short_row`, `long_row`,
`stray_cr`, `quote_junk`, `unterminated_quote`) in the same order, same BOM
handling, same CRLF/lone-CR rules inside and outside quotes. Verified byte
identical to the baseline on the practice set and on 16,074 differential
fuzz cases.

## How it is fast

The reference reads one character at a time and builds every field one
character at a time (`value += c`). This reader works record by record,
line by line, and cuts fields with V8's native string operations:

- **Tier 1, no quotes:** a record's line is sliced out once (a SlicedString,
  no copy) and `split(',')` cuts all its fields in one native call.
- **Tier 1, quotes:** the line is cut field by field with `indexOf('"')` and
  `indexOf(',')` — doubled quotes `""` collapse, junk after a closing quote
  is appended as the reference appends it, and a quote that does not close
  on the line bails out.
- **Tier 2, rare records:** a faithful port of the reference state machine
  (multiline quoted fields, stray CRs, unterminated quotes), but fields are
  accumulated as slices joined once, never character by character.

Nothing is kept from one `run()` call to the next; nothing is cached
between cases. Pure: no clock, no randomness, no locale.

## Benchmark (practice set, 6 cases, 10,193,953 chars, local Node 24)

| reader | CPU per set (avg of 5) |
|---|---|
| csv-reader 1.0.0 (baseline) | 760.6 ms |
| fast-csv-reader (this entry) | 183.9 ms |

Speedup **~4.1×**. Kit scorer on the practice set: `passed: 1`,
`cases_passed: 6/6`, and `answers.json` is byte-identical to the baseline's.
The repository is ~21 KB, far under the 1 MiB cap.

## Files

- `solve.js` — the reader. ES module, dependency-free, exports `run(input)`.
- `main.ts` — the harness driver (the house baseline's driver, kept as-is):
  reads `/input/cases.json`, answers each case with `run`, writes
  `/output/answers.json`. Sets `--no-incremental-marking` like the baseline.
- `package.json` — `{"type": "module"}` so `solve.js` loads as an ES module.
- `MODELS.md` — the 15 reader approaches studied; model 11 (Combined Best)
  is the reader in `solve.js`.
- `TRANSCRIPT.md` — build log.
- `LICENSE` — MIT.

## Run locally

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

## ATM note

When this entry was built (21 Nov 2026, ~05:00 UTC) the bounty leaderboard
was empty — no entries had been submitted yet, so there were no live top 10
entries to study. The approaches in `MODELS.md` are instead drawn from the
house baseline itself, the four public tools the kit rules name (papaparse,
d3-dsv, csv-parser, Rust csv / qsv), and the case generator's broken-row
distribution in the kit.
