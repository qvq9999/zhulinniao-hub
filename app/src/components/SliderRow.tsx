import type { LucideIcon } from 'lucide-react';

export interface SliderRowProps {
  label: string;
  icon?: LucideIcon;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** 数值后缀（如 %），formatValue 优先 */
  suffix?: string;
  /** 自定义数值文案（如平衡滑杆「居中」） */
  formatValue?: (v: number) => string;
  /** 强调色滑杆（竹青 → 朱砂） */
  accent?: boolean;
  disabled?: boolean;
  hint?: string;
  ariaLabel?: string;
}

/** 滑杆行 — 与原型 .field > .slider 结构 1:1，受控组件。 */
export default function SliderRow({
  label,
  icon: Icon,
  value,
  onChange,
  min = 0,
  max = 100,
  suffix,
  formatValue,
  accent = false,
  disabled = false,
  hint,
  ariaLabel,
}: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const display = formatValue ? formatValue(value) : `${value}${suffix ?? ''}`;

  return (
    <div className={`field${disabled ? ' is-disabled' : ''}`}>
      <div className="field__row">
        {Icon ? <Icon size={16} strokeWidth={1.5} /> : null}
        <span className="field__label">{label}</span>
        <span className="field__val">{display}</span>
      </div>
      <div className={`slider${accent ? ' slider--accent' : ''}`}>
        <div className="slider__track">
          <div className="slider__fill" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider__thumb" style={{ left: `${pct}%` }} />
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}
