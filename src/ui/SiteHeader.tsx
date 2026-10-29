/**
 * ui/SiteHeader.tsx
 *
 * Sticky top navigation bar with brand, and provisional warning badge.
 */

import type { FC } from 'react';

interface SiteHeaderProps {
  sheetCount: number;
}

const SiteHeader: FC<SiteHeaderProps> = ({ sheetCount }) => (
  <header className="site-header" role="banner">
    <div className="container">
      <div className="site-header__brand">
        <div className="site-header__logo" aria-hidden="true">G</div>
        <div>
          <div className="site-header__title">GPA Calculator</div>
          <div className="site-header__sub">Academic Performance Tracker</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {sheetCount > 0 && (
          <span className="site-header__badge" aria-live="polite">
            {sheetCount} sheet{sheetCount !== 1 ? 's' : ''} loaded
          </span>
        )}
        <span className="site-header__badge" style={{
          background: 'rgba(251,191,36,0.1)',
          color: 'var(--warning)',
          borderColor: 'rgba(251,191,36,0.25)',
        }}>
          ⚠ Provisional
        </span>
      </div>
    </div>
  </header>
);

export default SiteHeader;
