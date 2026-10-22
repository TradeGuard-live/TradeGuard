import React, { useState } from 'react';

export function GroupedBarChart({ data = [], height = 280, series = [] }) {
  const [hover, setHover] = useState(null);
  const width = 800;
  const pad = { top: 25, right: 25, bottom: 50, left: 65 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        No chart data available.
      </div>
    );
  }

  const allValues = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
  const min = Math.min(0, ...allValues);
  const max = Math.max(...allValues, 100);

  const groupW = innerW / data.length;
  const barW = Math.max(Math.min((groupW * 0.7) / (series.length || 1), 32), 6);

  const y = (v) => pad.top + innerH - ((v - min) / ((max - min) || 1)) * innerH;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const v = min + (max - min) * p;
          return (
            <g key={i}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--border)"
                strokeDasharray={i === 0 ? "none" : "3 3"}
              />
              <text x={pad.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                ₹{Math.round(v).toLocaleString('en-IN')}
              </text>
            </g>
          );
        })}

        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--text-secondary)"
          strokeWidth="1.5"
        />

        {data.map((d, i) => {
          const groupCenter = pad.left + (i + 0.5) * groupW;
          const totalBarsW = series.length * barW;
          const groupStartX = groupCenter - totalBarsW / 2;

          return (
            <g key={i}>
              {series.map((s, j) => {
                const v = Number(d[s.key]) || 0;
                const barY = v >= 0 ? y(v) : y(0);
                const barH = Math.max(Math.abs(y(v) - y(0)), v !== 0 ? 3 : 0);
                const isHovered = hover?.i === i && hover?.j === j;

                return (
                  <rect
                    key={s.key}
                    x={groupStartX + j * barW}
                    y={barY}
                    width={Math.max(barW - 3, 2)}
                    height={barH}
                    fill={isHovered ? '#60a5fa' : s.color}
                    rx="3"
                    style={{ cursor: 'pointer', transition: 'fill 0.15s, opacity 0.15s' }}
                    opacity={hover && hover.i !== i ? 0.6 : 1}
                    onMouseEnter={() => setHover({ i, j })}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}

              {/* Formatted Date / Period Label */}
              <text
                x={groupCenter}
                y={height - 18}
                textAnchor="middle"
                fontSize={data.length > 8 ? "10" : "11"}
                fontWeight="500"
                fill={hover?.i === i ? 'var(--text-primary)' : 'var(--text-muted)'}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          style={{
            position: 'absolute',
            left: `${((pad.left + (hover.i + 0.5) * groupW) / width) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -100%)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
            {data[hover.i].dateRange || data[hover.i].label}
          </div>
          {series.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              <span style={{ color: 'var(--text-muted)' }}>{s.label}:</span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, fontFamily: 'monospace' }}>
                ₹{Number(data[hover.i][s.key] || 0).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SimpleBarChart({ data = [], color = '#3b82f6', height = 280, valueFormatter = (v) => v }) {
  const [hover, setHover] = useState(null);
  const width = 800;
  const pad = { top: 25, right: 25, bottom: 50, left: 65 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        No chart data available.
      </div>
    );
  }

  const values = data.map((d) => Number(d.value) || 0);
  const max = Math.max(...values, 1) * 1.15;
  const barW = Math.max(Math.min((innerW / data.length) * 0.55, 45), 8);
  const y = (v) => pad.top + innerH - (Math.max(v, 0) / max) * innerH;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const v = max * p;
          return (
            <g key={i}>
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray="3 3" />
              <text x={pad.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                {Math.round(v).toLocaleString('en-IN')}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const cx = pad.left + (i + 0.5) * (innerW / data.length);
          const v = Number(d.value) || 0;
          const barH = Math.max(innerH - (y(v) - pad.top), v !== 0 ? 6 : (d.trades || d.value !== undefined ? 4 : 0));
          const isHovered = hover === i;

          return (
            <g key={i}>
              <rect
                x={cx - barW / 2}
                y={y(v)}
                width={barW}
                height={barH}
                fill={isHovered ? '#60a5fa' : color}
                rx="4"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer', transition: 'fill 0.15s' }}
              />
              <text
                x={cx}
                y={height - 18}
                textAnchor="middle"
                fontSize={data.length > 8 ? "10" : "11"}
                fontWeight="500"
                fill={isHovered ? 'var(--text-primary)' : 'var(--text-muted)'}
              >
                {d.label || d.day || d.name || ''}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${((pad.left + (hover + 0.5) * (innerW / data.length)) / width) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -100%)',
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
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {data[hover].dateRange || data[hover].label || data[hover].day || data[hover].name}
          </div>
          {data[hover].trades !== undefined && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              {data[hover].trades} executed trades
            </div>
          )}
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginTop: 2, fontFamily: 'monospace' }}>
            {valueFormatter(data[hover].value)}
          </div>
        </div>
      )}
    </div>
  );
}