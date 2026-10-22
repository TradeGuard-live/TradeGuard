import React, { useState } from 'react';

export default function LineChart({ data, height = 240, formatValue = (v) => v }) {
  const [hover, setHover] = useState(null);
  const width = 800;
  const pad = { top: 20, right: 20, bottom: 30, left: 60 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = data.map((d) => d.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(Math.abs(rawMax - rawMin) * 0.05, 1);
  const min = rawMin - padding;
  const max = rawMax + padding;

  const x = (i) => pad.left + (data.length <= 1 ? 0.5 : i / (data.length - 1)) * innerW;
  const y = (v) => pad.top + innerH - ((v - min) / (max - min)) * innerH;

  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.value)}`).join(' ');
  const area = `${path} L ${x(data.length - 1)} ${pad.top + innerH} L ${x(0)} ${pad.top + innerH} Z`;

  const ticks = 5;
  const yTicks = Array.from({ length: ticks }, (_, i) => min + ((max - min) * i) / (ticks - 1));

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
              ₹{Math.round(t / 1000)}K
            </text>
          </g>
        ))}

        <path d={area} fill="url(#areaGrad)" />
        <path d={path} fill="none" stroke="#3b82f6" strokeWidth="2" />

        {data.map((d, i) => (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(d.value)}
              r={hover === i ? 5 : 0}
              fill="#3b82f6"
              stroke="#0a0e1a"
              strokeWidth="2"
            />
            <rect
              x={x(i) - 20}
              y={pad.top}
              width="40"
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}

        {/* Decimated X-axis ticks to prevent overlap */}
        {data.filter((_, idx) => {
          if (data.length <= 6) return true;
          const step = Math.ceil(data.length / 6);
          return idx % step === 0 || idx === data.length - 1;
        }).map((d, i) => (
          <text
            key={i}
            x={x(data.indexOf(d))}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-muted)"
          >
            {d.date}
          </text>
        ))}

        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={pad.top + innerH}
              stroke="var(--text-secondary)"
              strokeDasharray="2 2"
            />
          </g>
        )}
      </svg>

      {hover !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${(x(hover) / width) * 100}%`,
            top: 10,
            transform: 'translateX(-50%)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10
          }}
        >
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{data[hover].date}</div>
          <div style={{ color: data[hover].value >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700, fontFamily: 'monospace', marginTop: 2 }}>
            Cumulative P&L: ₹{Number(data[hover].value).toLocaleString('en-IN')}
          </div>
        </div>
      )}
    </div>
  );
}