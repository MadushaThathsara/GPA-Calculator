/**
 * ui/FlagBadge.tsx
 *
 * Renders indicator flags per spec §5:
 *  - OCR: extracted via OCR only, may need checking.
 *  - Check this: text layer and OCR disagree.
 *  - Edited: user-corrected this session.
 */

import type { FC } from 'react';

type Flag = 'ocr' | 'check-this' | 'edited';

interface FlagBadgeProps {
  flags: Flag[];
  /** Also show small popover text explaining the flag */
  showLabel?: boolean;
}

const FLAG_CONFIG: Record<Flag, { label: string; className: string; icon: string; title: string }> = {
  'ocr': {
    label: 'OCR',
    className: 'flag--ocr',
    icon: '🔍',
    title: 'This value was extracted using OCR and may need checking.',
  },
  'check-this': {
    label: 'Check this',
    className: 'flag--check',
    icon: '⚠️',
    title: 'Text extraction and OCR disagree. Review both readings.',
  },
  'edited': {
    label: 'Edited',
    className: 'flag--edited',
    icon: '✏️',
    title: 'This value was manually corrected in this session.',
  },
};

const FlagBadge: FC<FlagBadgeProps> = ({ flags, showLabel = true }) => {
  if (flags.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', flexWrap: 'wrap' }}>
      {flags.map((flag) => {
        const cfg = FLAG_CONFIG[flag];
        if (!cfg) return null;
        return (
          <span
            key={flag}
            className={`flag ${cfg.className}`}
            title={cfg.title}
            aria-label={cfg.title}
          >
            {cfg.icon} {showLabel ? cfg.label : ''}
          </span>
        );
      })}
    </span>
  );
};

export default FlagBadge;
