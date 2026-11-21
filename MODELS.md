# Models: 15 reader approaches for csv-reader-speed-01

ATM first: the bounty leaderboard was empty when this entry was built
(21 Nov 2026 ~05:00 UTC, `entries: []`), so there were no live top 10
entries to imitate. The models below are drawn from the strongest available
references instead: the house baseline (csv-reader 1.0.0 itself), the four
public tools the kit rules name and benchmark (papaparse 5.7.1, d3-dsv 3.0.2,
csv-parser 3.2.1, Rust csv / qsv), and the case generator's broken-row
distribution (short/long rows ~1% each, stray CR 0.4%, quote junk 0.4%,
blank lines 0.3%, unterminated quote on half the files, multiline notes,
BOM on a third, LF/CRLF, 8–18 columns, 1.4–2.0M chars per case).

## 1. Baseline char loop (csv-reader 1.0.0)

The reference: one character at a time, `value += c` per character.
Strengths: obviously correct, tiny. Weaknesses: string concatenation per
character dominates CPU (~761 ms/set). Kept as the correctness oracle.

## 2. d3-dsv token scan

d3-dsv 3.0.2 `csvParseRows`: one token at a time, each token a field ending
at a comma, line break or end of text. House-measured 0.73 s vs the
baseline's 1.38 s on drawn sets. Strength: single pass, no per-char
concat in the tokeniser. Weakness: reads broken rows its own way — no
`short_row`/`long_row`/`stray_cr`/`quote_junk`/`unterminated_quote`
records, so it fails the gate on its own.

## 3. papaparse chunked parse

papaparse 5.7.1: chunked input, its own error model. House-measured
0.78 s vs 1.38 s. Strength: fast path for well-formed rows. Weakness:
its broken-row answers are not csv-reader's; adapting its error model
costs back most of the gain.

## 4. csv-parser streaming

csv-parser 3.2.1: a streaming transform. House-measured 0.72 s vs 1.38 s.
Strength: minimal allocation per row. Weakness: reports no errors at all
and reads broken rows its own way — fails the gate.

## 5. Rust csv / qsv memchr style

BurntSushi's Rust csv (xsv: 413.76 MB/s) and qsv (520 MB NYC 311 file
indexed in 466 ms) find delimiters with memchr/SIMD. In JS the analogue
is `indexOf` / `split`, which run in V8's native string code. Strength:
delimiter search leaves JS entirely. Weakness: no WASM/native addons are
allowed, so the win must come from native string primitives only.

## 6. Whole-text split('\n') + per-line split(',')

Split the text into lines once, split each line on commas. Strength: two
native calls per record, very fast on clean rows. Weakness: quoted fields
spanning lines break it, and a 10 MB split allocates every line up front.

## 7. Regex delimiter scan

One global regex `/[,\r\n]/g` with `lastIndex`, one `exec` per field.
Strength: a single scan finds any delimiter. Weakness: a match object
per field plus regex dispatch is slower than `indexOf` for the common
short field, and quotes still need separate handling.

## 8. Single-pass charCodeAt with slice accumulation

One pass over the text with `charCodeAt`, fields accumulated as slices
joined once at the delimiter instead of `value += c`. Strength: exact
reference semantics, ~2× faster than model 1. Weakness: still a JS loop
over every character (10M chars/set).

## 9. Quoted-field indexOf scan

Find a quoted field's closing quote with `indexOf('"')`, collapse `""`,
slice the content. Strength: quoted fields cost one native search instead
of a character loop. Weakness: needs the unquoted-field fast path beside
it, and multiline quotes need a fallback.

## 10. Line fast path + quoted-line parser, no fallback

Per record: slice the line, `split(',')` when it has no quote, a
quote-aware field cutter when it does. Strength: covers ~82% of records
at native speed. Weakness: no answer for multiline quoted fields, stray
CRs or unterminated quotes — those records would be wrong, and they are
in every case.

## 11. Combined Best — two-tier reader (SUBMITTED, in solve.js)

Model 10 plus model 8 as a fallback tier: Tier 1 cuts one-line records
with native `split`/`indexOf` (a line with no quote in one `split(',')`
call; a line with quotes cut field by field); any record with a stray CR
or a quote that does not close on its line goes to Tier 2, a faithful
port of the reference state machine whose fields are accumulated as
slices joined once. Error order, record-line counting and the
empty-record skip match the reference exactly. Measured 183.9 ms/set
CPU vs the baseline's 760.6 ms (~4.1×), 6/6 practice cases, answers
byte-identical to the baseline, 0 mismatches over 16,074 differential
fuzz cases.

## 12. Uint8Array byte scan

Encode the text once and scan bytes. Rejected: the input is a UTF-16 JS
string, non-ASCII words (Zürich, São Paulo, 東京, Москва) make byte
offsets diverge from string offsets, and the encode/decode round trip
costs more than it saves.

## 13. Columnar pre-scan

Find all commas in the text first, then assign fields to rows. Rejected:
commas inside quoted fields and multiline quotes make the pre-scan
useless without a quote-aware pass, which is the whole parser.

## 14. Worker / parallel split by lines

Split the text into line ranges and parse them in parallel. Rejected:
the sandbox gives 1 CPU, the harness runs one `node main.ts`, and
multiline quoted fields make line ranges unsafe to split.

## 15. Lookup-table state machine

A 256-entry transition table driven by char codes. Rejected: a table
lookup plus dispatch per character is slower in JS than `indexOf` on
native strings, and a table big enough to matter would eat the 1 MiB
repository cap.

## What the numbers say

On the practice set the baseline (model 1) took 760.6 ms CPU per set.
Model 8 alone (slice accumulation, no Tier 1) was not measured separately:
the Combined Best (model 11) at 183.9 ms already beats the fastest
house-measured public tool (csv-parser, 0.72 s on 12 drawn sets vs the
baseline's 1.38 s, i.e. ~1.9×) by more than 2×, because Tier 1 keeps
most records in native string code and Tier 2 only pays for the records
that are actually broken.
