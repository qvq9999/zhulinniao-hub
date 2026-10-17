export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedProps {
  /** 字符串简写或 { value, label } */
  options: (string | SegmentedOption)[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}

/** 分段选择 — 与原型 .segmented 结构 1:1（aria-pressed 标记选中），受控组件。 */
export default function Segmented({ options, value, onChange, ariaLabel, disabled = false }: SegmentedProps) {
  const opts: SegmentedOption[] = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  );

  return (
    <div className="segmented" role="group" aria-label={ariaLabel} style={disabled ? { opacity: 0.45 } : undefined}>
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          aria-pressed={o.value === value ? 'true' : 'false'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
