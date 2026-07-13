export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 160" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Document shape */}
      <path
        d="M30 20 L100 20 L100 28 Q100 20 108 20 L120 20 L140 40 L140 140 Q140 148 132 148 L38 148 Q30 148 30 140 Z"
        fill="#1a1a2e"
      />
      {/* Folded corner */}
      <path d="M120 20 L140 40 L120 40 Z" fill="#2d2d4e" />

      {/* S letter inside document */}
      <text x="52" y="105" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="72" fill="#1a1a2e">S</text>

      {/* Purple lines (text lines inside doc) */}
      <rect x="38" y="88" width="42" height="7" rx="3.5" fill="#7c5cbf" opacity="0.9"/>
      <rect x="38" y="102" width="35" height="7" rx="3.5" fill="#7c5cbf" opacity="0.7"/>
      <rect x="38" y="116" width="28" height="7" rx="3.5" fill="#7c5cbf" opacity="0.5"/>

      {/* X letter */}
      <text x="105" y="138" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="110" fill="url(#xgrad)">X</text>

      {/* Pixel dots above X */}
      <rect x="158" y="12" width="14" height="14" rx="3" fill="#7c5cbf"/>
      <rect x="176" y="4" width="11" height="11" rx="2.5" fill="#9b7de0"/>
      <rect x="176" y="18" width="8" height="8" rx="2" fill="#7c5cbf" opacity="0.7"/>

      <defs>
        <linearGradient id="xgrad" x1="105" y1="30" x2="210" y2="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9b7de0"/>
          <stop offset="100%" stopColor="#6b3fbf"/>
        </linearGradient>
      </defs>
    </svg>
  )
}
