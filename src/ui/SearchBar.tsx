/**
 * ui/SearchBar.tsx
 *
 * M5 — Index-number search bar with quick chips.
 * Spec §3: "The user enters an index number and sees every result for that student."
 * Spec §5: "Search by index number (normalised for case, spaces and slashes)."
 */

import { useState, type FC, type ChangeEvent, type FormEvent, useRef } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  disabled?: boolean;
  availableIndices?: string[];
}

const SearchBar: FC<SearchBarProps> = ({
  onSearch,
  disabled = false,
  availableIndices = [],
}) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(value.trim());
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    // Live search as user types
    if (v.trim().length >= 2) onSearch(v.trim());
    if (v.trim().length === 0) onSearch('');
  };

  const handleSelectChip = (indexNum: string) => {
    setValue(indexNum);
    onSearch(indexNum);
  };

  const handleClear = () => {
    setValue('');
    onSearch('');
    inputRef.current?.focus();
  };

  // Show up to 8 representative student index chips
  const displayChips = availableIndices.slice(0, 8);

  return (
    <div>
      <form onSubmit={handleSubmit} role="search" aria-label="Search by index number">
        <div className="search-wrap">
          {/* Search icon */}
          <svg
            className="search-wrap__icon"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>

          <input
            ref={inputRef}
            id="student-search-input"
            type="search"
            inputMode="text"
            className="search-input"
            placeholder="Search index number — e.g. 811 or ICT/23/811"
            value={value}
            onChange={handleChange}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            aria-label="Student index number"
          />

          {value && (
            <button
              type="button"
              className="search-clear"
              onClick={handleClear}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </form>

      {/* Quick student selection chips */}
      {displayChips.length > 0 && !disabled && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Quick pick:
            </span>
            {displayChips.map((idx) => {
              const isSelected = value.toUpperCase() === idx.toUpperCase();
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectChip(idx)}
                  style={{
                    background: isSelected ? 'var(--accent-2)' : 'rgba(255,255,255,0.05)',
                    color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                    border: `1px solid ${isSelected ? 'var(--accent-1)' : 'var(--border)'}`,
                    borderRadius: 'var(--r-full)',
                    fontSize: '0.75rem',
                    padding: '0.15rem 0.5rem',
                    cursor: 'pointer',
                    transition: 'all var(--t-fast)',
                    fontFamily: 'inherit',
                  }}
                >
                  {idx}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchBar;
