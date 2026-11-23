import sys, pathlib
root = pathlib.Path(sys.argv[1])
p = root / 'src/pages/DispatchPage.tsx'
part = (root / sys.argv[2]).read_text()
s = p.read_text()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
rep("import type { FormEvent } from 'react'", "import type { FormEvent, ReactNode } from 'react'")
rep("import type { BoardColumn, DispatchBoard, DispatchTicket, RescueUnit, TicketPriority, TicketSource } from '../utils/dispatch'",
    "import type { DispatchBoard, DispatchTicket, IntakeSos, RescueUnit, TicketPriority, TicketSource, TicketStatus } from '../utils/dispatch'")
a = s.index("const COLUMNS: { key: BoardColumn")
b = s.index("// A short two-tone chime")
s = s[:a] + """// The Operation list: new SOS first, then tickets by their next step.
type Group = 'sos' | 'waiting' | 'moving' | 'closed'
type Item =
  | { kind: 'sos'; key: string; sos: IntakeSos; group: Group; priority: TicketPriority; at: string | null }
  | { kind: 'ticket'; key: string; t: DispatchTicket; group: Group; priority: TicketPriority; at: string | null }
const GROUPS: { key: Group; title: string }[] = [
  { key: 'sos', title: 'Needs a ticket' }, { key: 'waiting', title: 'Waiting for a team' },
  { key: 'moving', title: 'Team on the way' }, { key: 'closed', title: 'Closed (7 days)' },
]
// Team progress shown as "Step n/4" (the team updates it from the app).
const STEP: Partial<Record<TicketStatus, number>> = { assigned: 1, acknowledged: 2, en_route: 3, on_scene: 4 }
""" + s[b:]
rep("  const loadBackups = () =>", """  // Operation list: selected row, search and filters.
  const [sel, setSel] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [brgyFilter, setBrgyFilter] = useState('')
  const [prioFilter, setPrioFilter] = useState<TicketPriority | ''>('')
  const [groupFilter, setGroupFilter] = useState<Group | 'backup' | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)
  const detailRef = useRef<HTMLElement | null>(null)
  const loadBackups = () =>""")
rep("""      instructions: '', equipment: s.equipment, unit: '', ...seed,
    })
    window.scrollTo?.({ top: 0, behavior: 'smooth' })""", """      instructions: '', equipment: s.equipment,
      // Suggest the best free team of this admin's own; the admin can change it.
      unit: String(rankUnits(ownUnits, s.equipment).find(r => r.unit.live_tickets === 0)?.unit.unit_id ?? ''), ...seed,
    })
    setAction(null); setHistory(null)
    if (window.innerWidth < 1000) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)""")
rep("}).then(() => setDraft(null)), draft.unit ? 'Ticket issued and assigned.' : 'Ticket issued. Assign a unit from the board.')",
    "}).then((id) => { setDraft(null); if (id) setSel(`t:${id}`) }), draft.unit ? 'Ticket created and the team was sent.' : 'Ticket created. Press \"Assign a team\" to send one.')")
a = s.index("  // A render helper, not a nested component")
b = s.index("    {board && tab === 'units'")
s = s[:a] + part + s[b:]
p.write_text(s)
print('ok')
