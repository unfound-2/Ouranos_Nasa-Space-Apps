import type { KeyboardEvent } from 'react'
import type { Region, RegionInfo } from '../lib/view'

/*
 * A stylised astronaut used as an evidence map, not an anatomical model. Coordinates are in
 * figure space (160 is the centre line); the figure sits inside a wider canvas so callouts
 * fit on both sides. The viewer's right arm is the astronaut's left, where the watch is worn.
 */

const MIRROR = 'translate(320 0) scale(-1 1)'
const ARM = 'M102 144 C84 148 74 162 71 184 L63 252 C61 280 59 304 59 326 L85 328 C87 304 91 282 95 256 L105 196 Z'
const LEG = 'M114 320 L157 320 L155 416 C154 440 153 470 151 500 L121 500 C119 470 118 440 117 416 Z'
const BOOT = 'M117 500 L153 500 L157 518 C158 526 152 530 145 530 L113 530 C106 530 104 523 107 517 Z'
const TORSO = 'M104 138 C120 128 200 128 216 138 C227 145 231 158 229 176 L219 234 C215 262 211 286 207 304 L113 304 C109 286 105 262 101 234 L91 176 C89 158 93 145 104 138 Z'
const VISOR = 'M126 70 C126 48 194 48 194 70 L194 84 C194 102 178 110 160 110 C142 110 126 102 126 84 Z'

const OFFSET = { x: 100, y: 16 }

const CALLOUT: Record<Region, { anchor: [number, number]; elbow: [number, number]; box: { x: number; y: number }; side: 'left' | 'right' }> = {
  HEAD: { anchor: [198, 62], elbow: [250, 40], box: { x: 352, y: 22 }, side: 'right' },
  CHEST: { anchor: [100, 214], elbow: [64, 196], box: { x: 8, y: 172 }, side: 'left' },
  ARMS: { anchor: [262, 330], elbow: [296, 352], box: { x: 352, y: 342 }, side: 'right' },
  LEGS: { anchor: [118, 452], elbow: [80, 470], box: { x: 8, y: 446 }, side: 'left' },
}

const STROKE: Record<RegionInfo['state'], string> = {
  neutral: 'var(--color-cyan)',
  data: 'var(--color-cyan)',
  caution: 'var(--color-amber)',
  symptom: 'var(--color-coral)',
}

export function Astronaut({
  regions,
  selected,
  onSelect,
  label = 'Crew health evidence map',
}: {
  regions: Record<Region, RegionInfo>
  selected: Region | null
  onSelect: (r: Region | null) => void
  label?: string
}) {
  const regionProps = (r: Region) => ({
    className: 'region',
    'data-state': regions[r].state,
    'data-selected': selected === r,
    role: 'button',
    tabIndex: 0,
    'aria-pressed': selected === r,
    'aria-label': `${regions[r].name}: ${regions[r].callout ?? 'no evidence recorded'}`,
    'data-testid': `region-${r}`,
    onClick: () => onSelect(selected === r ? null : r),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(selected === r ? null : r)
      }
    },
  })

  return (
    <svg viewBox="0 0 520 590" className="astro h-auto w-full select-none" role="group" aria-label={label}>
      <defs>
        <linearGradient id="gg-suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f2844" />
          <stop offset="1" stopColor="#111624" />
        </linearGradient>
        <linearGradient id="gg-suit-data" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#173a55" />
          <stop offset="1" stopColor="#10202f" />
        </linearGradient>
        <linearGradient id="gg-suit-caution" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3020" />
          <stop offset="1" stopColor="#1b1812" />
        </linearGradient>
        <linearGradient id="gg-suit-alert" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a1a2a" />
          <stop offset="1" stopColor="#1e1018" />
        </linearGradient>
        <linearGradient id="gg-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#45c4fa" stopOpacity="0" />
          <stop offset="0.5" stopColor="#45c4fa" stopOpacity="0.16" />
          <stop offset="1" stopColor="#45c4fa" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="gg-floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#45c4fa" stopOpacity="0.22" />
          <stop offset="1" stopColor="#45c4fa" stopOpacity="0" />
        </radialGradient>
        <pattern id="gg-lines" width="6" height="5" patternUnits="userSpaceOnUse">
          <rect width="6" height="1" fill="#45c4fa" opacity="0.09" />
        </pattern>
        <filter id="gg-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" in="SourceAlpha" result="blur" />
          <feFlood floodColor="#ff4b65" floodOpacity="0.55" />
          <feComposite in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="gg-body">
          <circle cx="160" cy="74" r="44" />
          <rect x="138" y="114" width="44" height="14" rx="6" />
          <path d={TORSO} />
          <rect x="110" y="304" width="100" height="16" rx="6" />
          <path d={ARM} />
          <path d={ARM} transform={MIRROR} />
          <ellipse cx="72" cy="346" rx="14" ry="17" />
          <ellipse cx="72" cy="346" rx="14" ry="17" transform={MIRROR} />
          <path d={LEG} />
          <path d={LEG} transform={MIRROR} />
          <path d={BOOT} />
          <path d={BOOT} transform={MIRROR} />
        </clipPath>
      </defs>

      <g transform={`translate(${OFFSET.x} ${OFFSET.y})`}>
        {/* floor */}
        <ellipse cx="160" cy="542" rx="150" ry="22" fill="url(#gg-floor)" />
        <ellipse cx="160" cy="542" rx="124" ry="15" fill="none" stroke="#45c4fa" strokeOpacity="0.28" />
        <ellipse cx="160" cy="542" rx="84" ry="9" fill="none" stroke="#45c4fa" strokeOpacity="0.18" />

        {/* arms (behind the torso) */}
        <g {...regionProps('ARMS')}>
          {[undefined, MIRROR].map((tf, i) => (
            <g key={i} transform={tf}>
              <path className="shape" d={ARM} />
              <ellipse className="shape" cx="72" cy="346" rx="14" ry="17" />
              <rect className="detail" x="57" y="322" width="30" height="9" rx="3.5" />
              <ellipse className="detail" cx="79" cy="252" rx="12" ry="7" />
            </g>
          ))}
          <g aria-hidden>
            <rect x="235" y="315" width="26" height="21" rx="5.5" fill="#0a0b12" stroke="#45c4fa" strokeOpacity="0.9" />
            <rect x="239" y="319" width="18" height="13" rx="3" fill="#45c4fa" fillOpacity="0.22" />
          </g>
        </g>

        {/* legs */}
        <g {...regionProps('LEGS')}>
          {[undefined, MIRROR].map((tf, i) => (
            <g key={i} transform={tf}>
              <path className="shape" d={LEG} />
              <ellipse className="detail" cx="136" cy="418" rx="16" ry="8" />
              <path className="shape" d={BOOT} />
            </g>
          ))}
        </g>

        {/* torso */}
        <g {...regionProps('CHEST')}>
          <path className="shape" d={TORSO} />
          <rect className="shape" x="110" y="304" width="100" height="16" rx="6" />
          <rect className="detail" x="134" y="166" width="52" height="38" rx="7" />
          <line className="detail" x1="142" y1="179" x2="178" y2="179" />
          <line className="detail" x1="142" y1="190" x2="166" y2="190" />
          <line className="detail" x1="160" y1="208" x2="160" y2="300" />
        </g>

        {/* helmet */}
        <g {...regionProps('HEAD')}>
          <rect className="shape" x="138" y="114" width="44" height="14" rx="6" />
          <circle className="shape" cx="160" cy="74" r="44" />
          <path d={VISOR} fill="#06080f" fillOpacity="0.82" stroke="#45c4fa" strokeOpacity="0.45" />
          <path d="M136 62 C144 54 162 52 176 57" fill="none" stroke="#f4f7ff" strokeOpacity="0.22" strokeWidth="2" strokeLinecap="round" />
        </g>

        {/* hologram texture and scan beam, clipped to the body and ignored by the pointer */}
        <g clipPath="url(#gg-body)" pointerEvents="none" aria-hidden>
          <rect x="40" y="20" width="240" height="520" fill="url(#gg-lines)" />
          <g className="astro-scan">
            <rect x="40" y="-60" width="240" height="70" fill="url(#gg-beam)" />
          </g>
        </g>

        {/* callouts */}
        {(Object.keys(CALLOUT) as Region[]).map((r) => {
          const info = regions[r]
          if (!info.callout) return null
          const c = CALLOUT[r]
          const color = STROKE[info.state]
          const [ax, ay] = c.anchor
          const [ex, ey] = c.elbow
          const bx = c.box.x - OFFSET.x
          const by = c.box.y - OFFSET.y
          const endX = c.side === 'right' ? bx : bx + 158
          return (
            <g key={r} pointerEvents="none" aria-hidden>
              <polyline points={`${ax},${ay} ${ex},${ey} ${endX},${by + 20}`} fill="none" stroke={color} strokeOpacity="0.75" strokeWidth="1" />
              <circle cx={ax} cy={ay} r="3" fill={color} />
              <foreignObject x={bx} y={by} width="160" height="54">
                <div
                  className={`rounded-lg border px-2.5 py-1.5 ${c.side === 'left' ? 'text-right' : 'text-left'}`}
                  style={{ borderColor: `color-mix(in oklab, ${color} 55%, transparent)`, background: 'color-mix(in oklab, var(--color-void) 82%, transparent)' }}
                >
                  <div className="text-[9.5px] leading-tight font-bold tracking-[0.08em]" style={{ color }}>
                    {info.callout}
                  </div>
                  <div className="mt-0.5 text-[8.5px] leading-tight tracking-[0.12em] text-ink-3 uppercase">{info.name}</div>
                </div>
              </foreignObject>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
