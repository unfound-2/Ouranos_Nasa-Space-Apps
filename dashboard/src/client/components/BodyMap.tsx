import type { Region, RegionInfo } from '../lib/view'
import { Astronaut } from './Astronaut'

export interface BodyMapProps {
  regions: Record<Region, RegionInfo>
  selected: Region | null
  onSelect: (r: Region | null) => void
  label: string
  /** 'hero': the large figure on the Overview. 'compact': inside a narrower card. */
  size?: 'hero' | 'compact'
}

/**
 * The crew member's body evidence map. Every caller renders this, never a figure directly, so the
 * figure can change (3D model, or the 2D drawing as a fallback) without touching the pages.
 * Contract for any implementation: one control per region with data-testid="region-<REGION>",
 * data-state, aria-pressed and role="button", selecting through onSelect.
 */
export function BodyMap({ regions, selected, onSelect, label }: BodyMapProps) {
  return <Astronaut regions={regions} selected={selected} onSelect={onSelect} label={label} />
}
