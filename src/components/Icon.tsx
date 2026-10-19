// Flaticon UIcons (Regular Straight). The stylesheet is loaded in index.html.
// Browse names at https://www.flaticon.com/uicons — use the part after "fi-rs-".
type IconProps = {
  name: string
  className?: string
  label?: string
}

export function Icon({ name, className = '', label }: IconProps) {
  return (
    <i
      className={`fi fi-rs-${name} ui-icon ${className}`.trim()}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
