import React, { useState } from 'react';

export default function DonutChart({ data, size = 200, thickness = 28 }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = data.map((d) => {
    const fraction = d.value / total;
    const dash = fraction * circumference;
    const seg = { ...d, dash, offset, fraction };
    offset += dash;
    return seg;
  });

  const hovered = hover !== null ? segments[hover] : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {segments.map((s, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === i ? thickness + 4 : thickness}
              strokeDasharray={`${s.dash} ${circumference - s.dash}`}
              strokeDashoffset={-s.offset}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: 'stroke-width 0.15s', cursor: 'pointer' }}
            />
          ))}
        </svg>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {hovered ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 600, color: hovered.color }}>
                {hovered.value}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hovered.label}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{total}%</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total</div>
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 160 }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="legend-item"
            style={{
              padding: '6px 0',
              cursor: 'pointer',
              opacity: hover === null || hover === i ? 1 : 0.5,
            }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="legend-color" style={{ background: d.color }} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}