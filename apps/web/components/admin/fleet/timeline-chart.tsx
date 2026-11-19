'use client';

/**
 * Tymczasowy renderer modelu wykresu (ADR 0072) dla osi czasu „Historia stanów”: zamienia kształty z geometrii
 * `intervalTimeline` (packages/shared/src/charts) na React SVG, z dymkiem na najechanie i fokus klawiatury, legendą
 * i „Pokaż jako tabelę”. Do zastąpienia wspólnym komponentem `Chart` z `components/admin/charts/chart.tsx`
 * (pulpit i raporty), gdy trafi do tej gałęzi: wejście to ten sam `ChartModel`, więc zamiana dotyczy tylko importu.
 */
import type { ChartModel, ChartShape } from '@hulajnogi/shared';
import { useId, useState } from 'react';
import { t } from '../../../lib/i18n';
import { ListIcon } from '../icons';

function Shape({ shape, hatchId }: { shape: ChartShape; hatchId: string }) {
  switch (shape.kind) {
    case 'rect':
      return (
        <g>
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
          />
          {shape.hatch && (
            <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={`url(#${hatchId})`} />
          )}
        </g>
      );
    case 'line':
      return (
        <line
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          strokeDasharray={shape.dash}
        />
      );
    case 'text':
      return (
        <text
          x={shape.x}
          y={shape.y}
          fill={shape.fill}
          fontSize={shape.fontSize}
          fontWeight={shape.numeric ? 500 : shape.fontWeight}
          textAnchor={shape.anchor}
        >
          {shape.text}
        </text>
      );
    case 'path':
      return <path d={shape.d} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.strokeWidth} />;
  }
}

export function TimelineChart({ model, tableToggle = true }: { model: ChartModel; tableToggle?: boolean }) {
  const hatchId = useId().replace(/:/g, '');
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const target = model.targets.find((x) => x.index === active) ?? null;

  return (
    <div className="tl-chart">
      {table ? (
        <div className="tl-table" role="table" aria-label={model.description}>
          <div className="row head" role="row">
            {model.table.columns.map((c) => (
              <span key={c} role="columnheader">
                {c}
              </span>
            ))}
          </div>
          {model.table.rows.map((row, i) => (
            <div key={i} className="row" role="row">
              {row.map((cell, j) => (
                <span key={j} role="cell" className={j > 0 ? 'num' : undefined}>
                  {cell || t('statusHistory.now')}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="tl-svg-wrap">
          <svg
            width={model.width}
            height={model.height}
            viewBox={`0 0 ${model.width} ${model.height}`}
            role="img"
            aria-label={model.description}
          >
            <defs>
              <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#B9B9B2" strokeWidth="2" />
              </pattern>
            </defs>
            {model.shapes.map((shape, i) => (
              <Shape key={i} shape={shape} hatchId={hatchId} />
            ))}
            {model.targets.map((x, i) => (
              <rect
                key={`t${i}`}
                x={x.x}
                y={x.y}
                width={x.width}
                height={x.height}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={[x.title, ...x.lines].join(', ')}
                className="tl-target"
                onMouseEnter={() => setActive(x.index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(x.index)}
                onBlur={() => setActive(null)}
              />
            ))}
          </svg>
          {target && (
            <div
              className="tl-tip"
              role="tooltip"
              style={{
                left: Math.min(Math.max(target.x + target.width / 2, 90), model.width - 90),
                top: target.y + target.height + 8,
              }}
            >
              <b>{target.title}</b>
              {target.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="tl-legend">
        {model.legend.map((item) => (
          <span key={item.key} className="lg">
            <span
              className={item.hatch ? 'sw hatch' : 'sw'}
              style={{ background: item.color }}
              aria-hidden="true"
            />
            {item.label}
            {item.value && <span className="num muted">{item.value}</span>}
          </span>
        ))}
        <span className="spacer" />
        {tableToggle && (
          <button type="button" className="link pr-link-btn" onClick={() => setTable((v) => !v)}>
            <ListIcon size={15} />
            {table ? t('statusHistory.showChart') : t('statusHistory.showTable')}
          </button>
        )}
      </div>
    </div>
  );
}
