# Transcript — fast-csv-reader build log

Bounty: csv-reader-speed-01-run-20261121, "Read broken CSV files faster,
21 November 2026", $100, deadline Mon 23 Nov 2026 09:42 +07.
Builder session: this Muse session (see the bundled session record).
Account: @roblok-rf (GitHub roblok-rf).

## 1. Kit and brief

- Fetched the kit JSON and tarball from make.fun; unpacked to
  `~/workspace/makefun-kit-csv-reader-speed-01-run-20261121/`.
- Read `competition.yaml`, `rules/instance.yaml`, the baseline
  (`baselines/csv-reader/`: `main.ts`, `solve.js`, `vendor/csv-reader/index.js`),
  the scorer (`program/scorer/main.ts`) and the case generator
  (`program/generator/subject/csv-cases.mjs`).
- Deliverables: `solve.js` (ES module, `run(input)`), `main.ts` (the house
  driver, kept as-is), repo at most 1 MiB, Node 22, no WASM/native addons.
- Leaderboard check at build time: `entries: []` — no live top 10 existed,
  so the ATM study used the baseline, the four public tools the kit rules
  name (papaparse, d3-dsv, csv-parser, Rust csv/qsv) and the generator's
  broken-row distribution. See MODELS.md.

## 2. Design (model 11, Combined Best)

- Tier 1 per record: slice the line once; `split(',')` when it holds no
  quote; a quote-aware field cutter (`indexOf('"')` / `indexOf(',')`) when
  it does. Stray CR or an unclosed quote bails to Tier 2.
- Tier 2: a faithful port of the reference state machine (multiline quoted
  fields, stray CRs, quote junk, unterminated quotes), fields accumulated
  as slices joined once instead of character-by-character concatenation.
- Error order, record-line counting and the empty-record skip verified
  against the reference by differential testing.

## 3. Verification

- Practice set (6 cases, 10,193,953 chars): kit scorer `passed: 1`,
  `cases_passed: 6/6`; `answers.json` byte-identical to the baseline's.
- CPU per set, avg of 5 runs, local Node 24: baseline 760.6 ms,
  this entry 183.9 ms — ~4.1× faster.
- Differential fuzz vs csv-reader 1.0.0: 16,074 random and structured
  broken-CSV cases (random soup, generator-style records, edge cases:
  empty text, BOM only, lone CRs, `"""`, unterminated quotes, quote junk,
  CRLF/LF mixes, multiline quotes) — 0 mismatches. The fuzz script lives
  outside the repo (it imports the kit's reference); the counts above are
  the run's own output.

## 4. Files

- `solve.js`, `main.ts`, `package.json`, `README.md`, `MODELS.md`,
  `TRANSCRIPT.md`, `LICENSE` — all written and edited with file writes
  in this session, then committed locally (see the commit hash in the
  submission report) and bundled with the kit CLI.
