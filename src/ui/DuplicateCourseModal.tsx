/**
 * ui/DuplicateCourseModal.tsx
 *
 * M4 — Duplicate sheet handling modal dialog.
 *
 * Spec §3 Core flow 2:
 * "If a sheet for the same course already exists, the user chooses Replace
 * (swap the old sheet for the new one) or Repeat/Resit (keep both).
 * The system never assumes a later sheet is a resit, because it could
 * also be a sheet for absent students."
 */

import type { FC } from 'react';
import type { MockSheet } from '../store/useSessionStore';

interface DuplicateCourseModalProps {
  existingSheet: MockSheet;
  newSheet: MockSheet;
  onReplace: () => void;
  onKeepRepeatResit: () => void;
  onCancel: () => void;
}

const DuplicateCourseModal: FC<DuplicateCourseModalProps> = ({
  existingSheet,
  newSheet,
  onReplace,
  onKeepRepeatResit,
  onCancel,
}) => {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-modal-title"
    >
      <div className="modal-card animate-in">
        <div className="modal-header">
          <div className="card__icon card__icon--warning" aria-hidden="true">
            ⚠️
          </div>
          <div>
            <h3 id="dup-modal-title" className="modal-title">
              Duplicate Course Detected
            </h3>
            <p className="modal-subtitle">
              Course <strong>{newSheet.courseCode}</strong> is already loaded
            </p>
          </div>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            {existingSheet.fileName === newSheet.fileName
              ? `The file "${newSheet.fileName}" for course ${newSheet.courseCode} has already been uploaded in this session. You can replace the existing sheet or keep it as a repeat session to avoid duplicate counts.`
              : `A result sheet for course ${newSheet.courseCode} (${newSheet.courseName}) is already loaded in the current session. How would you like to handle the incoming sheet?`}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
              marginBottom: '1.25rem',
              padding: '0.875rem',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
            }}
          >
            <div>
              <span className="section-label" style={{ color: 'var(--text-muted)' }}>Currently Loaded</span>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                {existingSheet.displayName}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {existingSheet.examSession ?? 'Session unknown'} · {existingSheet.rows.length} rows
              </p>
            </div>

            <div>
              <span className="section-label" style={{ color: 'var(--accent-1)' }}>Incoming File</span>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                {newSheet.displayName}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {newSheet.examSession ?? 'Session unknown'} · {newSheet.rows.length} rows
              </p>
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 0.875rem',
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.2)',
              borderRadius: 'var(--r-sm)',
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            💡 <strong>Replace:</strong> Swaps the old sheet with this new version.<br />
            💡 <strong>Repeat/Resit:</strong> Keeps both sheets. Repeat grades will be applied to the student's original semester with university cap rules.
          </div>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onKeepRepeatResit}
          >
            Keep as Repeat/Resit
          </button>
          <button
            type="button"
            className="btn btn--warning btn--sm"
            onClick={onReplace}
          >
            Replace Sheet
          </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateCourseModal;

