# Tests

## Directory layout

```
tests/
  fixtures/
    pdfs/           ← Place sample1.pdf and sample2.pdf here (not committed to git)
    expectedRows.ts ← Hand-written expected extraction outputs
  e2e/              ← Playwright end-to-end tests (M8+)
```

## Fixture PDFs

The two sample sheets referenced in spec §15 M0 must be placed at:
- `tests/fixtures/pdfs/sample1.pdf`
- `tests/fixtures/pdfs/sample2.pdf`

These files are **not committed to the repository** because they contain student data.
Add the following to `.gitignore`:

```
tests/fixtures/pdfs/
```

## Unit tests

Unit tests live alongside source files in `src/`:
- `src/engine/*.test.ts`
- `src/rules/*.test.ts`
- etc.

Run with: `npm test`

## E2E tests

End-to-end tests live in `tests/e2e/` and use Playwright.
Run with: `npx playwright test`
