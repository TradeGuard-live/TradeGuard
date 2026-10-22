import React from 'react';

export default function Toggle({ checked, onChange }) {
  return (
    <div
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange?.(!checked)}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange?.(!checked);
        }
      }}
    >
      <div className="toggle-knob" />
    </div>
  );
}