import type { LucideIcon } from 'lucide-react';

export interface SwitchRowProps {
  label: string;
  icon?: LucideIcon;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** 强调色轨道（朱砂） */
  accent?: boolean;
  hint?: string;
  disabled?: boolean;
}

/** 开关行 — 与原型 .field > .switch 结构 1:1，受控组件。 */
export default function SwitchRow({
  label,
  icon: Icon,
  checked,
  onChange,
  accent = false,
  hint,
  disabled = false,
}: SwitchRowProps) {
  return (
    <div className={`field${disabled ? ' is-disabled' : ''}`}>
      <div className="field__row">
        {Icon ? <Icon size={16} strokeWidth={1.5} /> : null}
        <span className="field__label">{label}</span>
        <label className="switch" style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className={`switch__track${accent ? ' switch__track--accent' : ''}`} />
        </label>
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}
