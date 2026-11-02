import { useState, type ReactNode } from 'react'

// A short row of buttons that switches between parts of one page, so two
// related tools can share a sidebar tab. Parts stay mounted once opened so
// switching back keeps what the officer typed.
type Part = { key: string; label: string; content: ReactNode }

export function SubTabs({ parts, label }: { parts: Part[]; label: string }) {
  const [active, setActive] = useState(parts[0].key)
  const [opened, setOpened] = useState<string[]>([parts[0].key])

  function open(key: string) {
    setActive(key)
    setOpened((keys) => (keys.includes(key) ? keys : [...keys, key]))
  }

  return (
    <>
      <div className="analytics-tabs" role="tablist" aria-label={label}>
        {parts.map((part) => (
          <button
            key={part.key}
            type="button"
            role="tab"
            id={`subtab-${part.key}`}
            aria-selected={active === part.key}
            aria-controls={`subpanel-${part.key}`}
            className={`analytics-tab ${active === part.key ? 'active' : ''}`}
            onClick={() => open(part.key)}
          >
            {part.label}
          </button>
        ))}
      </div>
      {parts.map((part) => opened.includes(part.key) && (
        <div
          key={part.key}
          role="tabpanel"
          id={`subpanel-${part.key}`}
          aria-labelledby={`subtab-${part.key}`}
          hidden={active !== part.key}
        >
          {part.content}
        </div>
      ))}
    </>
  )
}
