/**
 * rules/universities/uoc.ts
 *
 * First university configuration — populated from the spec brief.
 * ALL VALUES ARE PROVISIONAL until verified against the official grading document.
 * See spec §12 (still needed from you) and open risks §10.
 *
 * University: University of Colombo (assumed from sample sheets — spec §12 notes
 * "which university the samples belong to" is still needed).
 */
import type { UniversityConfig } from '../schema';

const uocConfig: UniversityConfig = {
  name: 'University of Colombo (Provisional)',
  lastVerified: null,
  provisional: true,

  // Spec §4, Table 1 — PROVISIONAL
  gradeScale: {
    'A+': 4.0,
    'A':  4.0,
    'A-': 3.7,
    'B+': 3.3,
    'B':  3.0,
    'B-': 2.7,
    'C+': 2.3,
    'C':  2.0,
    'C-': 1.3,
    'D':  1.0,
    'E':  0.0,
  },

  // Spec §4 status table — PROVISIONAL
  statusRules: {
    'E':                 { inGpa: true  },  // counted as 0.0
    'E(ESA)':            { inGpa: true  },  // counted as 0.0
    'E(CA)':             { inGpa: true  },  // counted as 0.0
    'AB':                { inGpa: false },  // absent, excluded
    'AB(ESA)':           { inGpa: false },  // absent, excluded
    'AB(CA)':            { inGpa: false },  // absent, excluded
    'AB(CA) & AB(ESA)':  { inGpa: false },  // compound absent, excluded
    'E(CA) & AB(ESA)':   { inGpa: false },  // compound absent, excluded
    'N':                 { inGpa: false },  // academic concession, excluded
    'W':                 { inGpa: false },  // withdrawn, excluded
  },

  // Spec §4 repeat/resit cap — PROVISIONAL
  repeatCap: {
    eligibleOriginals: ['C-', 'D', 'E', 'E(CA)', 'E(ESA)'],
    capTriggers: ['B+', 'A-', 'A', 'A+'],
    capGrade: 'B',
  },

  // Spec §4 classification table — PROVISIONAL
  classificationBands: [
    { label: 'First Class',           minCgpa: 3.70 },
    { label: 'Second Class (Upper)',  minCgpa: 3.30 },
    { label: 'Second Class (Lower)',  minCgpa: 3.00 },
    { label: 'Pass',                  minCgpa: 2.00 },
  ],

  // Spec §4 credits rule
  creditRule: { source: 'lastDigitOfCode' },

  // Spec §2 — to be populated from official list
  nonGpaModules: [],

  // Spec §5 — index number format (supports ICT, ITC, and UoC faculty programs)
  indexNumberPattern: '^(ICT|ITC|IT|IS|CS|SE|ET|BST|AT|FOT)/\\d{2}/\\d{3}$',
};

export default uocConfig;
