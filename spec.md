# GPA Calculator and Academic Performance Tracker: Spec Summary

Final interview output (Batches 1 to 7). Status: awaiting your go-ahead for the implementation plan.

## 1. Product

A static website with no server and no database. Students upload university result-sheet PDFs. The browser extracts index numbers, course details, grades and statuses (text layer plus OCR), calculates SGPA and CGPA, shows the degree classification, and draws progress graphs. Nothing is stored beyond the browser session.

**Users:** any student, no login. Lookup covers only sheets uploaded in the current session. Nothing is shared between users, so nobody can alter another person's data.

**Top priority:** accurate extraction and correct SGPA and CGPA. Graphs are secondary.

## 2. Scope

### In scope for v1

- Upload one or many PDFs: drag-and-drop on desktop, tap-to-select on mobile.
- OCR on every page, compared with the text layer where one exists.
- Extraction of course code, course name, exam session, index numbers, grades and statuses.
- Display file name renamed from content: `<CourseCode>_<CourseName>.pdf`.
- Semester sections created from the printed exam session (for example "Second Semester 2026"). If none is found, the user is told and can drag the sheet into a section or add one manually.
- Search by index number, with results per semester, SGPA, CGPA, classification, and "from N modules / X GPA credits".
- Display of GPA credits only.
- Inline correction of grades and statuses only, with an "Edited" marker and automatic recalculation.
- Per-university rule sets in fixed configuration files.
- Graphs: SGPA trend, CGPA trend, grade distribution, semester comparison, improvement or decline overview.

### Out of scope for v1

Accounts, server or database, cross-user sharing, permanent storage, marks, user-editable university rules, registered or earned credit displays, history of replaced sheets, and automatic university detection (neither sample sheet names a university).

## 3. Core flows

1. **Upload.** The user drops PDFs. The browser extracts and displays results immediately, with no mandatory review.
2. **Duplicate course.** If a sheet for the same course already exists, the user chooses **Replace** (swap the old sheet for the new one) or **Repeat/Resit** (keep both). The system never assumes a later sheet is a resit, because it could also be a sheet for absent students.
3. **Search.** The user enters an index number and sees every result for that student, organized by semester.
4. **Correct.** The user edits a grade or status. The row gets an "Edited" marker, and SGPA, CGPA, classification and graphs recalculate.
5. **Missing credits.** If credits can't be inferred from the module code, the user enters them manually.

## 4. Calculation rules

All rules live in each university's fixed configuration. Values below come from your brief and answers and are **provisional until verified against the official grading document**.

### Grade points

| Grade | Points |
| --- | --- |
| A+ | 4.0 |
| A | 4.0 |
| A- | 3.7 |
| B+ | 3.3 |
| B | 3.0 |
| B- | 2.7 |
| C+ | 2.3 |
| C | 2.0 |
| C- | 1.3 |
| D | 1.0 |
| E | 0.0 |

### Credits

GPA credits equal the last digit of the module code (IN3462 = 2, IC3433 = 3, IC3341 = 1; IIC 2242 = 2 after normalizing the space). If the digit isn't usable, the user enters the value manually. Manual values need no special label.

### Formulas

- SGPA = Σ(credits × grade points) ÷ Σ credits, over GPA-eligible, counted modules in a semester.
- CGPA = the same formula across all semesters.
- Results always display as "from N modules / X GPA credits", with no claim that the semester or degree record is complete.

### Classification (highest applicable threshold)

| Classification | CGPA |
| --- | --- |
| First Class | 3.70 and above |
| Second Class (Upper) | 3.30 and above |
| Second Class (Lower) | 3.00 and above |
| Pass | 2.00 and above |

The site states that the final award depends on other requirements, including successful completion of all semesters.

### Status handling

| Status | Shown | In GPA |
| --- | --- | --- |
| E, E(ESA), E(CA) | Yes | Counted as 0.0 |
| AB(ESA), AB(CA) & AB(ESA), E(CA) & AB(ESA) | Yes | Excluded |
| N (academic concession) | Yes | Excluded |
| W (withdrawn) | Yes | Excluded |

Statuses are shown separately in each semester's results. Non-GPA modules from the university configuration are excluded, and the user can also include or exclude modules within their own session.

### Repeat/resit rules

The repeat/resit result is applied to the **original semester**, and that semester's SGPA, the CGPA and the classification are recalculated. Only the relevant student's row is affected, never the whole sheet.

| Original result | Repeat/resit result | Used for GPA |
| --- | --- | --- |
| C-, D, E, E(CA), E(ESA) | Above B (B+, A-, A, A+) | B (3.0), cap applied |
| C-, D, E, E(CA), E(ESA) | B or lower (including E) | Actual repeat grade; E counts 0.0 |
| AB, AB(CA) & AB(ESA), E(CA) & AB(ESA) | Any grade | Full repeat grade, no cap |
| B, B+, A-, A, A+ | Any | Original kept |
| C+, C | Any | Original kept |
| N, W | Any | Stays displayed and excluded |
| Any | Repeat grade is AB | Original unchanged |

Additional points:

- A repeat grade always replaces an eligible original, **even if it is lower** (original C-, repeat D gives D).
- The capped grade affects only the GPA value. The sheet still shows the actual repeat grade with a note such as "capped at B for GPA".
- Both the original and repeat sheets stay available, and the original result remains visible in history on the student's page.
- Cap grade, cap trigger list and eligible-original list are per-university configuration.

## 5. Extraction pipeline and indicators

1. Render every page and run OCR on it, including pages with a text layer.
2. Where a text layer exists, extract it as well and compare it with OCR for each field.
3. Validate every index number against the pattern `ICT/yy/nnn` and flag mismatches.
4. Compare the number of rows read with the number of rows visible on the page. This is an estimate from the page image, so it is a warning signal and not proof.
5. If the two readings disagree, **the OCR reading is the working value**. Both readings stay visible beside the result.

### Indicators

- **OCR:** this value was extracted using OCR and may need checking. It does not mean the value is wrong.
- **Check this:** text extraction and OCR disagree. Both readings are shown.
- **Edited:** the user corrected this value. The original extraction remembers its OCR origin.

### Why OCR runs on every page

Your first sample's text layer silently dropped minus signs: 811 reads `A` in the text but is `A-`, and 825 and 869 read `B` but are `B-`. A grade like that still looks valid, so a text-only parser would inflate GPAs without any error. OCR on every page is the safeguard.

## 6. Editing

- Editable: **grades and statuses only.**
- Not editable through the correction interface: index numbers, module codes, GPA credits.
- Each correction applies only to its result row, in the current session only.
- After any edit, SGPA, CGPA, classification and all graphs recalculate together.

## 7. Data model (browser memory)

- **University config:** grade scale, classification bands, credit rule, status rules, repeat/resit and cap rules, non-GPA module list.
- **Sheet:** course code, course name, exam session, type (original or repeat/resit), file name, row-count result.
- **Result row:** normalized index number, text reading, OCR reading, working value, grade or status, OCR/Check this/Edited flags.
- **Module:** code, GPA credits, GPA-eligible flag.
- **Derived:** each student's effective result per module, SGPA per semester, CGPA, classification.

Marks are never read, stored or used.

## 8. Architecture

A static site where everything runs client-side: PDF text extraction, page rendering, OCR, calculation and charts. University rule sets ship as fixed configuration files, so adding a university is a release. There are no third-party services, so no student data leaves the device. Uploaded files and extracted data live in the browser session and clear when it ends. Library versions will be confirmed against current documentation before the plan.

## 9. Assumptions

- **A1:** credits equal the last digit of the module code; 0 or a non-digit prompts manual entry.
- **A2:** a student who appears only on a resit sheet counts in that sheet's semester, flagged "no original sheet found".
- **A3:** with several resits, the latest gradable one is used, judged by printed sheet date, otherwise upload order.
- **A4:** a repeat result of N or W leaves the original unchanged.
- **A5:** the grade scale, classification bands, cap rule and status handling are provisional until the official document is verified.
- **A6:** the user can include or exclude individual modules in their own session.
- **A7:** extracted rows are kept in browser tab storage so a refresh doesn't force reprocessing. Uploaded PDF files are held in memory only.
- **A8:** the **OCR** indicator is shown where the working value came from OCR alone (no text layer, or text layer unusable). Because OCR runs on every page, marking every result would make the indicator meaningless. Disagreements get **Check this** instead. Please confirm.
- **A9:** the exam session printed on a sheet identifies the semester. When it isn't printed, the user assigns it.
- **A10:** friend lookup works only for students on sheets uploaded in the same session.

## 10. Open risks

- **Silent shared error:** if text and OCR both misread a grade the same way, nothing is flagged.
- **No mandatory review:** the first SGPA shown may be wrong until the user notices an indicator.
- **Partial data:** a CGPA from some sheets can be mistaken for a final one.
- **Unverified rules:** grade scale, N/W handling, cap rule, industrial-training credits and classification need confirming.
- **Resit ambiguity:** a later sheet may be a resit, an absentee sitting or a correction, so a wrong choice gives wrong results.
- **Performance:** OCR on every page in a phone browser will be slow for many pages.
- **Provisional sheets:** both samples are first versions and grades may change.
- **No audit trail:** nothing is kept after the session.
- **Credit rule:** the last-digit rule is confirmed only by your examples and the sample course codes.

## 11. Definition of done for v1

- Both sample sheets extract to the correct rows, including every `A-` and `B-` (811 = A-, 825 = B-, 869 = B-).
- A purely scanned, image-only sheet works end to end.
- One real student's SGPA matches a hand-calculated value.
- Every row of the resit table has a passing test, including the cap boundary: original D with resit B+ gives 3.0, resit B gives 3.0, resit B- gives 2.7.
- Editing a grade updates SGPA, CGPA, classification and graphs.

## 12. Still needed from you (not blocking)

- The official grading document (N/W rules, pass mark, cap rule, classification).
- One real student's full semester results with their official SGPA.
- A sample resit or absentee sheet.
- Which university the samples belong to, for the first configuration.

**Next step:** confirm A8 and say "Ready" and I'll turn this into an implementation plan.

# Implementation Plan

Built from the spec above. A8 (OCR badge only where OCR was the sole source; Check this on disagreement) is used as the default until you say otherwise.

## 13. Technical approach

- **Language and build:** TypeScript with a Vite static build, React for the UI.
- **PDF handling:** pdf.js for page rendering and text-layer extraction with word positions.
- **OCR:** Tesseract.js running in Web Workers, with the language data and worker files bundled into the site so no request leaves the device.
- **Charts:** Recharts or Chart.js, chosen at M7 by bundle size.
- **Testing:** Vitest for the rules engine and parsers, Playwright for end-to-end flows.
- **Hosting:** any static host.
- **Versions:** exact library versions are confirmed against current documentation at the start of M0 and pinned. I have not assumed them from memory.

## 14. Project structure

- `rules/` holds one config file per university plus a schema and validator.
- `engine/` is pure TypeScript with no browser dependencies: grade points, credits, effective-result selection, SGPA, CGPA, classification. It is the most heavily tested part.
- `extract/` holds page rendering, text-layer reading, OCR, reconciliation and sheet parsing.
- `store/` holds the session model (sheets, rows, edits) and tab-storage persistence.
- `ui/` holds upload, semester sections, search, results, edit dialog and graphs.

Keeping `engine/` free of UI and extraction code means the accuracy-critical logic can be tested against hand-calculated values on its own.

## 15. Milestones

### M0. Setup and fixtures

- Create the project, pin library versions, add the linting and test setup.
- Store the two sample sheets as fixtures with hand-written expected rows. Include 811 = A-, 825 = B-, 869 = B-.
- Define the university config schema.

**Done when:** the project builds, tests run, and fixtures plus expected outputs are committed.

### M1. Rules engine

- Grade scale, status table and credit-from-code rule, including space normalization (IIC 2242 = 2).
- Effective-result selection with the full resit table: cap at B for `C-`, `D`, `E`, `E(CA)`, `E(ESA)`; full grade for AB-type originals; originals of B or higher and `C+`/`C` kept; resit `E` counts 0.0; resit `AB`, `N`, `W` leave the original unchanged; a lower resit still replaces an eligible original.
- SGPA, CGPA, classification, and the "from N modules / X GPA credits" figures.
- A first university config populated from your brief, flagged unverified.

**Done when:** a test exists for every row of the resit table, including the cap boundary (original D: resit B+ = 3.0, B = 3.0, B- = 2.7), and the engine matches hand-calculated SGPA and CGPA examples.

### M2. PDF rendering and text layer

- Load PDFs, render each page to an image at an OCR-friendly resolution, and extract text items with positions.
- Reconstruct rows from positions, not from raw text order. This avoids the glued-row problem in the first sample (`ICT/23/908 AICT/23/909 B+`).
- Read the header: course code, course name, sheet date, exam session when printed.

**Done when:** the first sample yields the right set of index numbers, with the known minus-sign loss visible as text-layer output.

### M3. OCR and reconciliation

- Run OCR on every rendered page in workers with a progress indicator and cancellation.
- Use OCR word positions to match each index number with its grade, in both table columns.
- Match text and OCR readings per cell. If they disagree, the OCR reading becomes the working value, both are stored, and the row is marked **Check this**.
- Mark **OCR** only where OCR is the sole source (no usable text layer).
- Validate index numbers against `ICT/yy/nnn`, detect duplicates, and compare the row count with a table-row estimate from the page image.
- Parse compound statuses such as `E(CA) & AB(ESA)` into CA and ESA parts.

**Done when:** both samples extract correctly, an image-only version of a sample passes, and every known minus-sign case is flagged or correct.

### M4. Sheets, semesters and duplicates

- Build the sheet model and the display file name `<CourseCode>_<CourseName>.pdf`.
- Create semester sections from the printed exam session. If none is found, show the message, support drag-and-drop into a section, and offer manual add.
- Same course uploaded again: show **Replace** or **Repeat/Resit**. Suggest, but never assume.
- Replace swaps the sheet. Repeat/Resit keeps both and applies the resit result to the student's original semester.
- Handle the "no original sheet found" case and multiple resits (latest gradable wins).

**Done when:** replace and resit flows work end to end and recalculate the right semester.

### M5. Search and results UI

- Index number search (normalized for case, spaces and slashes) over the session's sheets.
- Results per semester with module code, GPA credits, grade, points, status, indicators and the original result when a resit applies.
- SGPA, CGPA, classification, and the note that the final award depends on other requirements.
- Manual credit entry when the code gives no usable digit, and per-module include/exclude in the session.

**Done when:** a full student record displays correctly for the sample data.

### M6. Editing

- Edit grades and statuses only. Index numbers, module codes and credits are locked.
- Mark edited rows with **Edited**, keep the original readings, and apply each edit to its own row only.
- Recalculate SGPA, CGPA, classification and graphs together after every edit.

**Done when:** edits change results correctly and the original reading stays inspectable.

### M7. Graphs

- SGPA trend, CGPA trend, grade distribution, semester comparison and an improvement/decline summary.
- Charts update from the same derived state as the tables.

**Done when:** charts match the numbers in the tables after uploads, resits and edits.

### M8. Hardening

- Session persistence in tab storage, and clearing on session end.
- Performance: page-by-page OCR with a queue, a progress bar, and cancellation. Test on a mid-range phone.
- Mobile layout with tap-to-select upload, and accessibility checks (keyboard, contrast, labels on indicators).
- Error handling for corrupt, password-protected and empty PDFs, and for sheets that don't match the expected layout.

### M9. Verification and release

- Run the full done-criteria list from section 11.
- Verify against a real student's official SGPA once you provide it.
- Replace provisional rule values once the official grading document arrives.

## 16. Test plan

- **Unit:** grade points, credit parsing, every resit-table row, SGPA/CGPA with excluded statuses, classification boundaries (3.70, 3.30, 3.00, 2.00).
- **Parser:** glued rows, two-column layout, compound statuses, the index number validator.
- **Extraction:** both samples against expected rows, an image-only sample, and a deliberately degraded scan.
- **End to end:** upload, search, replace, resit, edit, graphs.
- **Manual:** one real student's hand-calculated result.

## 17. Order of work and risks

- **Order:** M0, M1, then M2 and M3 together, M4, M5, M6, M7, M8, M9. The engine comes first because accuracy is the top priority and it needs no PDF to test.
- **Biggest technical risk:** OCR reading of small minus signs. Mitigation: higher render resolution, a character whitelist for grade cells, position-based cell matching, and the Check this comparison.
- **Second risk:** layouts that differ from the two samples. Mitigation: a clear failure message plus a request for a sample, rather than guessing.
- **Third risk:** phone OCR speed. Mitigation: page queue, progress, and cancel; measured at M8.

## 18. What I need to start

- Your go-ahead on A8.
- The official grading document, for the first real university config.
- One real student's results with the official SGPA, for M9.
- A sample resit or absentee sheet, ideally before M4.
