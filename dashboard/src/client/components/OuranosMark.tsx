import './ouranos.css'

/**
 * The Ouranos logo: the name set in Pinyon Script, a bundled script face (no image, no glyph).
 * `lg` adds an optional plain line under it for entry screens.
 */
export function OuranosMark({ size = 'sm', tagline }: { size?: 'sm' | 'lg'; tagline?: string }) {
  return (
    <span className={`ouranos-mark ouranos-mark-${size}`}>
      <span className="ouranos-word">Ouranos</span>
      {tagline && <span className="ouranos-tagline">{tagline}</span>}
    </span>
  )
}
