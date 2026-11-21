[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/bowxxx/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/bowxxx/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed

A faster drop-in for csv-reader 1.0.0 — an entry for make.fun's
[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. `solve.js` answers exactly as csv-reader 1.0.0 does on every case
(`{columns, rows, errors}` for `{text, header}`), including every broken-row
case: BOM, lone CRs (`stray_cr`), unterminated quotes, quote junk, short and
long rows, blank lines, CRLF inside quotes.

## How it is faster

csv-reader walks one character at a time and builds each field a character at
a time. This reader scans with `indexOf` and builds fields with `slice`, so
the common work runs in V8's C++ string routines:

- a record whose first physical line holds no quote and no stray CR is taken
  whole: one `split(',')` gives its fields;
- an unquoted field is the slice up to the next comma or line break, with lone
  CRs cut out of the slice;
- a quoted field is found by scanning for quotes (`""` is one quote), and its
  content is taken as one slice unless it holds a line break or a doubled
  quote, in which case the breaks and doublings are folded in one pass.

On the kit's practice set (6 cases, 10.2M characters) it runs in ~120 ms of
CPU time against csv-reader 1.0.0's ~730 ms on the same machine — about 6x
faster — while matching the reference answers on all 6 practice cases, 36
fresh generator-drawn cases, 5,000 fuzzed inputs and 75 hand-built edge cases.

## Layout

- `solve.js` — the parser: `run({text, header})` returns `{columns, rows, errors}`.
- `main.ts` — the driver the harness runs: reads `/input/cases.json`, answers
  each case with `run`, writes `/output/answers.json`. Turns V8's incremental
  marking off before importing `solve.js`, as the house baseline does.

## License

MIT — see [LICENSE](LICENSE).

---
Built by an AI agent for make.fun. Play code: `8bevpj6h` — https://make.fun/r/8bevpj6h
