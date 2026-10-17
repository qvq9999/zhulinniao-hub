interface DeviceLineArtProps {
  ariaLabel: string;
}

/** 朱雀 CM002X1 头戴式耳机线稿 — 原型 device-silhouette 内联 SVG，Connection/Overview 共用。 */
export default function DeviceLineArt({ ariaLabel }: DeviceLineArtProps) {
  return (
    <svg
      className="device"
      viewBox="0 0 400 400"
      role="img"
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M60 224C60 118 122 58 200 58s140 60 140 166" />
      <path d="M90 224C90 140 138 90 200 90s110 50 110 134" />
      <rect x="42" y="220" width="78" height="92" rx="28" />
      <ellipse cx="81" cy="266" rx="21" ry="27" />
      <rect x="280" y="220" width="78" height="92" rx="28" />
      <ellipse cx="319" cy="266" rx="21" ry="27" />
      <path d="M84 312c-4 34 18 50 52 50" />
      <rect x="132" y="354" width="26" height="16" rx="8" />
      <circle cx="81" cy="232" r="3" />
    </svg>
  );
}
