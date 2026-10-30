/**
 * ui/ConfirmClearModal.tsx
 *
 * M8 — Confirmation modal before clearing all session data.
 * Cleans up uploaded sheets, extracted records, grade corrections, and selections.
 */

import { useEffect, type FC } from 'react';

interface ConfirmClearModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmClearModal: FC<ConfirmClearModalProps> = ({ onConfirm, onCancel }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal-card animate-in">
        <div className="modal-header">
          <div
            className="card__icon card__icon--danger"
            aria-hidden="true"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              color: 'var(--danger)',
            }}
          >
            🗑️
          </div>
          <div>
            <h3 id="clear-modal-title" className="modal-title">
              Clear All Session Data?
            </h3>
            <p className="modal-subtitle">
              This action cannot be undone
            </p>
          </div>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Are you sure you want to clear all uploaded result sheets, extracted student records,
            user grade corrections, and module selections in this session?
          </p>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.625rem', lineHeight: 1.4 }}>
            💡 All session data will be wiped clean from the browser.
          </p>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onCancel}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={onConfirm}
          >
            Yes, Clear Everything
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmClearModal;

