import type { KeyboardEvent } from 'react'
import type { Region, RegionInfo } from '../lib/view'

/*
 * A suited crew member used as an evidence map, not an anatomical model, drawn like the body
 * diagram on a clinical chart: grey outline, numbered regions, marks only where evidence was
 * recorded. Front view; the viewer's right arm is the crew member's left, where the watch is worn.
 * Coordinates are in the original 560 x 640 canvas; the view box crops to the figure.
 *
 * Marker grammar (the same marks head the evidence list):
 *   red circle         = REPORTED      (a symptom someone reported; never a detection)
 *   blue diamond       = MEASURED      (where a recorded measurement was taken or what it describes)
 *   amber open diamond = CHECK SOURCE  (a recorded measurement whose source needs verifying)
 */

const MIRROR = 'translate(560 0) scale(-1 1)'

const P = {
  helmet: 'M230 96 C230 58 252 40 280 40 C308 40 330 58 330 96 C330 128 310 150 280 150 C250 150 230 128 230 96 Z',
  visor: 'M242 92 C242 70 258 60 280 60 C302 60 318 70 318 92 L318 104 C318 124 302 136 280 136 C258 136 242 124 242 104 Z',
  torso:
    'M214 182 C234 168 326 168 346 182 C360 192 366 210 362 232 L352 290 C348 312 342 326 336 336 L224 336 C218 326 212 312 208 290 L198 232 C194 210 200 192 214 182 Z',
  arm: 'M204 182 C184 186 170 202 167 222 L157 286 C155 302 153 322 151 344 L148 373 L183 377 L187 347 C189 325 193 305 197 291 L211 236 Z',
  glove: 'M147 377 C139 388 138 404 144 416 C150 428 170 430 179 418 C186 406 186 390 183 377 Z',
  thumb: 'M180 388 C188 388 193 395 190 403 C188 409 182 410 178 406',
  hip: 'M224 350 L336 350 L334 396 C320 402 240 402 226 396 Z',
  leg: 'M228 394 L277 394 L273 478 C272 502 271 530 269 556 L237 556 C235 530 233 502 232 478 Z',
  boot: 'M233 558 L273 558 L277 582 C278 592 271 597 262 597 L228 597 C220 597 216 591 219 582 Z',
}

export const REGION_ORDER: Region[] = ['HEAD', 'CHEST', 'ARMS', 'LEGS']
export const REGION_NO: Record<Region, number> = { HEAD: 1, CHEST: 2, ARMS: 3, LEGS: 4 }

const ANCHOR: Record<Region, { x: number; y: number; side: 'left' | 'right' }> = {
  HEAD: { x: 322, y: 86, side: 'right' },
  CHEST: { x: 256, y: 232, side: 'left' },
  ARMS: { x: 394, y: 368, side: 'right' },
  LEGS: { x: 252, y: 478, side: 'left' },
}

export const KIND: Record<RegionInfo['state'], { tag: string; color: string } | null> = {
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
        {active && <circle className="astro-pulse" cx={x} cy={y} r={9} fill="none" stroke={k.color} strokeWidth={1.5} />}
        <circle cx={x} cy={y} r={7.5} fill={k.color} stroke="var(--color-panel)" strokeWidth={2} />
      </g>
    )
  return (
    <g>
      {active && <rect className="astro-pulse" x={x - 8} y={y - 8} width={16} height={16} fill="none" stroke={k.color} strokeWidth={1.5} transform={`rotate(45 ${x} ${y})`} />}
      <rect
        x={x - 6.5}
        y={y - 6.5}
        width={13}
        height={13}
        fill={state === 'caution' ? 'var(--color-panel)' : k.color}
        stroke={state === 'caution' ? k.color : 'var(--color-panel)'}
        strokeWidth={state === 'caution' ? 2 : 1.5}
        transform={`rotate(45 ${x} ${y})`}
      />
    </g>
  )
}

/** The same mark as on the figure, for lists and legends. */
export function KindMark({ state }: { state: RegionInfo['state'] }) {
  const k = KIND[state]
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {state === 'symptom' && <circle cx="6" cy="6" r="4.5" fill={k!.color} />}
      {state === 'data' && <rect x="2.4" y="2.4" width="7.2" height="7.2" fill={k!.color} transform="rotate(45 6 6)" />}
      {state === 'caution' && <rect x="2.6" y="2.6" width="6.8" height="6.8" fill="none" stroke={k!.color} strokeWidth="1.6" transform="rotate(45 6 6)" />}
      {state === 'neutral' && <line x1="2" y1="6" x2="10" y2="6" stroke="var(--color-ink-3)" strokeWidth="1.5" />}
    </svg>
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
    'aria-label': `${REGION_NO[r]}, ${regions[r].name}: ${regions[r].callout ?? 'no evidence recorded'}`,
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
    <svg viewBox="118 30 324 578" className="astro h-auto w-full select-none" role="group" aria-label={label}>
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
          <rect x="383" y="358" width="22" height="20" rx="4" fill="var(--color-ink)" />
          <rect x="387" y="362" width="14" height="12" rx="2" fill="var(--color-ink-2)" />
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
        <path d={P.visor} fill="var(--color-raised)" stroke="var(--color-ink-3)" strokeOpacity="0.7" />
      </g>

      {/* region numbers, and a mark where evidence was recorded */}
      {REGION_ORDER.map((r) => {
        const a = ANCHOR[r]
        const info = regions[r]
        const kind = KIND[info.state]
        const marked = Boolean(kind && info.callout)
        const nx = a.x + (a.side === 'right' ? 13 : -13)
        return (
          <g key={r} pointerEvents="none" aria-hidden>
            {marked ? (
              <Marker state={info.state} x={a.x} y={a.y} active={selected === r} />
            ) : (
              <g stroke="var(--color-ink-3)" strokeOpacity="0.55">
                <line x1={a.x - 4} y1={a.y} x2={a.x + 4} y2={a.y} />
                <line x1={a.x} y1={a.y - 4} x2={a.x} y2={a.y + 4} />
              </g>
            )}
            <text
              x={nx}
              y={a.y + 5.5}
              textAnchor={a.side === 'right' ? 'start' : 'end'}
              fontSize="16"
              fontWeight="700"
              fill={marked ? kind!.color : 'var(--color-ink-3)'}
              stroke="var(--color-panel)"
              strokeWidth="4"
              paintOrder="stroke"
            >
              {REGION_NO[r]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** The numbered findings beside the figure. Selecting one selects the region on the figure. */
export function EvidenceList({ regions, selected, onSelect }: { regions: Record<Region, RegionInfo>; selected: Region | null; onSelect: (r: Region | null) => void }) {
  const marked = REGION_ORDER.filter((r) => KIND[regions[r].state] && regions[r].callout)
  const blank = REGION_ORDER.filter((r) => !marked.includes(r))
  return (
    <div className="min-w-0" data-testid="evidence-list">
      <div className="micro mb-1.5 px-2">Recorded evidence by region</div>
      {marked.length ? (
        <ol className="divide-y divide-hair border-y border-hair">
          {marked.map((r) => {
            const info = regions[r]
            const k = KIND[info.state]!
            const active = selected === r
            const sub = info.items[0]?.detail ?? ''
            return (
              <li key={r}>
                <button
                  type="button"
                  data-testid={`callout-${r}`}
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : r)}
                  className={`grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2 px-2 py-2 text-left transition-colors hover:bg-panel-2 ${active ? 'bg-raised hover:bg-raised' : ''}`}
                >
                  <span className="pt-[3px]">
                    <KindMark state={info.state} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="text-[12.5px] font-semibold text-ink">
                        {REGION_NO[r]} · {info.name}
                      </span>
                      <span className="text-[10.5px] font-bold tracking-[0.04em]" style={{ color: k.color }}>
                        {k.tag}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[12px] font-medium text-ink">{info.callout}</span>
                    {sub && <span className="block text-[11.5px] leading-snug text-ink-3">{sub}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="border-y border-hair px-2 py-2 text-[12px] text-ink-3">Nothing recorded for any region.</p>
      )}
      {marked.length > 0 && blank.length > 0 && (
        <p className="mt-1.5 px-2 text-[11.5px] text-ink-3">No evidence: {blank.map((r) => `${REGION_NO[r]} ${regions[r].name.toLowerCase()}`).join(', ')}</p>
      )}
    </div>
  )
}
