import type { KeyboardEvent } from 'react'
import type { Region, RegionInfo } from '../lib/view'

/*
 * A suited crew member used as an evidence map, not an anatomical model. Front view; the
 * viewer's right arm is the crew member's left, where the watch is worn. Coordinates are in a
 * 560 x 640 canvas with the figure on the centre line (x = 280) and callouts in both margins.
 *
 * Marker grammar:
 *   coral circle  = REPORTED   (a symptom someone reported; never a detection)
 *   cyan diamond  = MEASURED   (where a recorded measurement was taken or what it describes)
 *   amber diamond = CHECK      (a recorded measurement whose source needs verifying)
 */

const MIRROR = 'translate(560 0) scale(-1 1)'

const P = {
  helmet: 'M230 96 C230 58 252 40 280 40 C308 40 330 58 330 96 C330 128 310 150 280 150 C250 150 230 128 230 96 Z',
  visor: 'M242 92 C242 70 258 60 280 60 C302 60 318 70 318 92 L318 104 C318 124 302 136 280 136 C258 136 242 124 242 104 Z',
  pack: 'M200 176 C200 166 208 160 218 160 L342 160 C352 160 360 166 360 176 L360 330 C360 340 352 346 342 346 L218 346 C208 346 200 340 200 330 Z',
  torso:
    'M214 182 C234 168 326 168 346 182 C360 192 366 210 362 232 L352 290 C348 312 342 326 336 336 L224 336 C218 326 212 312 208 290 L198 232 C194 210 200 192 214 182 Z',
  arm: 'M204 182 C184 186 170 202 167 222 L157 286 C155 302 153 322 151 344 L148 373 L183 377 L187 347 C189 325 193 305 197 291 L211 236 Z',
  glove: 'M147 377 C139 388 138 404 144 416 C150 428 170 430 179 418 C186 406 186 390 183 377 Z',
  thumb: 'M180 388 C188 388 193 395 190 403 C188 409 182 410 178 406',
  hip: 'M224 350 L336 350 L334 396 C320 402 240 402 226 396 Z',
  leg: 'M228 394 L277 394 L273 478 C272 502 271 530 269 556 L237 556 C235 530 233 502 232 478 Z',
  boot: 'M233 558 L273 558 L277 582 C278 592 271 597 262 597 L228 597 C220 597 216 591 219 582 Z',
}

const ANCHOR: Record<Region, { x: number; y: number; side: 'left' | 'right'; boxY: number; id: string }> = {
  HEAD: { x: 322, y: 86, side: 'right', boxY: 46, id: 'R1' },
  CHEST: { x: 256, y: 232, side: 'left', boxY: 196, id: 'R2' },
  ARMS: { x: 394, y: 368, side: 'right', boxY: 336, id: 'R3' },
  LEGS: { x: 252, y: 478, side: 'left', boxY: 446, id: 'R4' },
}

const KIND: Record<RegionInfo['state'], { tag: string; color: string } | null> = {
  symptom: { tag: 'REPORTED', color: 'var(--color-coral)' },
  data: { tag: 'MEASURED', color: 'var(--color-cyan)' },
  caution: { tag: 'CHECK SOURCE', color: 'var(--color-amber)' },
  neutral: null,
}

function Marker({ state, x, y, active }: { state: RegionInfo['state']; x: number; y: number; active: boolean }) {
  const k = KIND[state]
  if (!k) return null
  if (state === 'symptom')
    return (
      <g>
        {active && <circle className="astro-pulse" cx={x} cy={y} r={7} fill="none" stroke={k.color} strokeWidth={1.5} />}
        <circle cx={x} cy={y} r={5.5} fill={k.color} stroke="var(--color-void)" strokeWidth={2} />
      </g>
    )
  return (
    <g>
      {active && <rect className="astro-pulse" x={x - 6} y={y - 6} width={12} height={12} fill="none" stroke={k.color} strokeWidth={1.5} transform={`rotate(45 ${x} ${y})`} />}
      <rect
        x={x - 4.5}
        y={y - 4.5}
        width={9}
        height={9}
        fill={state === 'caution' ? 'var(--color-void)' : k.color}
        stroke={k.color}
        strokeWidth={1.8}
        transform={`rotate(45 ${x} ${y})`}
      />
    </g>
  )
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
    <svg viewBox="0 0 560 640" className="astro h-auto w-full select-none" role="group" aria-label={label}>



      <g {...regionProps('ARMS')}>
        {[undefined, MIRROR].map((tf, i) => (
          <g key={i} transform={tf}>
            <path className="part" d={P.arm} />
            <circle className="part" cx="204" cy="196" r="20" />
            <path className="part" d={P.glove} />
            <path className="seam" d={P.thumb} />
            <ellipse className="seam" cx="172" cy="292" rx="15" ry="5.5" transform="rotate(-8 172 292)" />
            <ellipse className="seam" cx="166" cy="376" rx="16" ry="5" />
          </g>
        ))}
        {/* the watch, on the crew member's left wrist */}
        <g aria-hidden>
          <rect x="383" y="358" width="22" height="20" rx="4" fill="var(--color-void)" stroke="var(--color-ink-2)" />
          <rect x="387" y="362" width="14" height="12" rx="2" fill="var(--color-raised)" />
        </g>
      </g>

      <g {...regionProps('LEGS')}>
        <path className="part" d={P.hip} />
        {[undefined, MIRROR].map((tf, i) => (
          <g key={i} transform={tf}>
            <path className="part" d={P.leg} />
            <path className="part" d={P.boot} />
            <ellipse className="seam" cx="252" cy="478" rx="21" ry="7" />
            <ellipse className="seam" cx="253" cy="556" rx="18" ry="5" />
            <path className="seam" d="M236 584 L274 584" />
          </g>
        ))}
      </g>

      <g {...regionProps('CHEST')}>
        <path className="part" d={P.torso} />
        <rect className="part" x="222" y="334" width="116" height="18" rx="8" />
        <rect className="seam" x="252" y="212" width="56" height="40" rx="7" />
        <path className="seam" d="M260 224 H300 M260 234 H288 M260 244 H294" />
        <path className="seam" d="M280 258 V330" />
        <path className="seam" d="M216 196 C238 186 322 186 344 196" />
      </g>

      <g {...regionProps('HEAD')}>
        <ellipse className="part" cx="280" cy="158" rx="44" ry="10" />
        <path className="part" d={P.helmet} />
        <path d={P.visor} fill="var(--color-void)" stroke="var(--color-ink-3)" strokeOpacity="0.8" />
      </g>


      {/* region ids and evidence callouts */}
      {(Object.keys(ANCHOR) as Region[]).map((r) => {
        const a = ANCHOR[r]
        const info = regions[r]
        const kind = KIND[info.state]
        const active = selected === r
        if (!kind || !info.callout)
          return (
            <g key={r} pointerEvents="none" aria-hidden>
              <line x1={a.x - 4} y1={a.y} x2={a.x + 4} y2={a.y} stroke="var(--color-ink)" strokeOpacity="0.25" />
              <line x1={a.x} y1={a.y - 4} x2={a.x} y2={a.y + 4} stroke="var(--color-ink)" strokeOpacity="0.25" />
              <text x={a.x + (a.side === 'right' ? 8 : -8)} y={a.y - 6} textAnchor={a.side === 'right' ? 'start' : 'end'} fill="var(--color-ink-3)" fontSize="10">
                {a.id}
              </text>
            </g>
          )
        const boxX = a.side === 'right' ? 404 : 8
        const boxW = 148
        const edgeX = a.side === 'right' ? boxX : boxX + boxW
        const elbowX = a.side === 'right' ? Math.max(a.x + 18, boxX - 22) : Math.min(a.x - 18, edgeX + 22)
        const midY = a.boxY + 24
        const sub = info.items[0]?.detail ?? ''
        return (
          <g key={r} pointerEvents="none" aria-hidden data-testid={`callout-${r}`}>
            <polyline points={`${a.x},${a.y} ${elbowX},${midY} ${edgeX},${midY}`} fill="none" stroke={kind.color} strokeOpacity={active ? 1 : 0.7} strokeWidth={1} />
            <Marker state={info.state} x={a.x} y={a.y} active={active} />
            <foreignObject x={boxX} y={a.boxY} width={boxW} height={96}>
              <div
                className={`rounded-[3px] border bg-panel px-2 py-1.5 ${a.side === 'left' ? 'text-right' : 'text-left'}`}
                style={{ borderColor: active ? kind.color : 'var(--color-line)' }}
              >
                <div className="flex items-center gap-1.5" style={{ justifyContent: a.side === 'left' ? 'flex-end' : 'flex-start' }}>
                  <span className="text-[9px] text-ink-3">{a.id}</span>
                  <span className="text-[9px] font-bold tracking-[0.04em]" style={{ color: kind.color }}>
                    {kind.tag}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] leading-tight font-semibold text-ink">{info.callout}</div>
                <div className="mt-0.5 line-clamp-2 text-[9.5px] leading-snug text-ink-3">{sub}</div>
              </div>
            </foreignObject>
          </g>
        )
      })}
    </svg>
  )
}
