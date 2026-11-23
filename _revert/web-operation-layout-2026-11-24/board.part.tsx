  // ---------------------------------------------------------------- one list + one detail panel
  const isSuper = !!board?.is_super_admin
  const teamAskOf = (t: DispatchTicket) => backups.find(b => b.ticket_id === t.ticket_id && b.need === 'team')
  const otherBackupsOf = (t: DispatchTicket) => backups.filter(b => b.ticket_id === t.ticket_id && b.need !== 'team')
  const sosPriority = (a: IntakeSos): TicketPriority => (a.alert_level ?? 0) >= 3 ? 'critical' : 'high'
  const ticketName = (t: DispatchTicket) => (t.resident_uid ? residentById.get(t.resident_uid)?.name : '') || t.subject
  const groupOfTicket = (t: DispatchTicket): Group => t.status === 'open' ? 'waiting' : columnOf(t.status) === 'closed' ? 'closed' : 'moving'
  const items: Item[] = board ? [
    ...board.intake_sos.map((a): Item => ({ kind: 'sos', key: `sos:${a.alert_id}`, sos: a, group: 'sos', priority: sosPriority(a), at: a.created_at })),
    ...tickets.map((t): Item => ({ kind: 'ticket', key: `t:${t.ticket_id}`, t, group: groupOfTicket(t), priority: t.priority,
      at: columnOf(t.status) === 'closed' ? t.closed_at : t.created_at })),
  ] : []
  const counts: Record<Group, number> = { sos: 0, waiting: 0, moving: 0, closed: 0 }
  items.forEach(i => { counts[i.group] += 1 })
  const backupTickets = new Set(backups.filter(b => b.need !== 'team').map(b => b.ticket_id))

  // Search: name, ticket number (D-0024, #24 or 24), barangay, sitio, place, team.
  const needle = query.trim().toLowerCase()
  const ticketNo = needle.match(/^(?:#|d-?)?0*(\d+)$/)?.[1]
  const matches = (i: Item) => {
    if (!needle) return true
    if (i.kind === 'sos') {
      const r = residentById.get(i.sos.resident_uid)
      return [i.sos.resident_name, i.sos.barangay_name ?? barangayName(i.sos.barangay_id), r?.sitio, i.sos.alert_type, i.sos.note]
        .some(s => s && s.toLowerCase().includes(needle))
    }
    const t = i.t
    const r = t.resident_uid ? residentById.get(t.resident_uid) : undefined
    if (ticketNo && String(t.ticket_no) === ticketNo) return true
    return [ticketLabel(t), t.subject, r?.name, r?.sitio, barangayName(t.barangay_id), t.location_note, unitById(t.assigned_unit_id)?.unit_name]
      .some(s => s && s.toLowerCase().includes(needle))
  }
  const shown = items.filter(i => {
    const brgy = i.kind === 'sos' ? i.sos.barangay_id : i.t.barangay_id
    if (brgyFilter && String(brgy) !== brgyFilter) return false
    if (prioFilter && i.priority !== prioFilter) return false
    if (groupFilter === 'backup') { if (i.kind !== 'ticket' || !backupTickets.has(i.t.ticket_id)) return false }
    else if (groupFilter && i.group !== groupFilter) return false
    return matches(i)
  })
  // Most urgent first, then whoever has waited longest. Closed: latest first.
  const PRIO_RANK: Record<TicketPriority, number> = { critical: 0, high: 1, normal: 2 }
  const sorted = (g: Group) => shown.filter(i => i.group === g).sort((a, b) => g === 'closed'
    ? Date.parse(b.at ?? '') - Date.parse(a.at ?? '')
    : PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || Date.parse(a.at ?? '') - Date.parse(b.at ?? ''))
  const groups = GROUPS.map(g => ({ ...g, list: sorted(g.key) }))
  const ordered = groups.filter(g => g.key !== 'closed').flatMap(g => g.list)
  const selected = items.find(i => i.key === sel) ?? (draft ? undefined : ordered[0])
  const showClosed = closedOpen || groupFilter === 'closed' || !!needle

  function pick(key: string) {
    setSel(key); setDraft(null); setAction(null); setHistory(null)
    if (window.innerWidth < 1000) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  const toggleGroup = (g: Group | 'backup') => setGroupFilter(f => f === g ? null : g)

  function renderRow(i: Item) {
    const isSel = selected?.key === i.key
    let title: string, sub: ReactNode, pill: ReactNode = null
    if (i.kind === 'sos') {
      const a = i.sos
      title = a.resident_name
      sub = <>{a.alert_type ?? 'SOS'} · {a.barangay_name ?? barangayName(a.barangay_id)}{a.headcount ? ` · ${a.headcount} ${a.headcount === 1 ? 'person' : 'people'}` : ''}
        {outsideCordova(a.latitude, a.longitude) ? ' · Outside Cordova' : ''}</>
      pill = <span className="op-pill pill-sos">{newSos.has(a.alert_id) ? 'New SOS' : 'SOS'}</span>
    } else {
      const t = i.t
      const unit = unitById(t.assigned_unit_id)
      const asked = teamAskOf(t)
      title = `${ticketLabel(t)} · ${ticketName(t)}`
      if (i.group === 'waiting') {
        sub = <>{SOURCE_LABELS[t.source]} · {barangayName(t.barangay_id)}</>
        pill = <span className={`op-pill ${asked ? 'pill-asked' : 'pill-wait'}`}>{asked ? (isSuper ? 'Asks for a team' : 'Asked municipality') : 'No team'}</span>
      } else if (i.group === 'moving') {
        sub = <>{unit?.unit_name ?? 'Team'} · {STATUS_LABELS[t.status]} · {barangayName(t.barangay_id)}</>
        pill = <span className="op-pill pill-step">Step {STEP[t.status] ?? 1}/4</span>
      } else {
        sub = <>{STATUS_LABELS[t.status]} · {barangayName(t.barangay_id)}</>
      }
      if (backupTickets.has(t.ticket_id)) pill = <span className="op-pill pill-sos">Backup asked</span>
    }
    return <li key={i.key}>
      <button type="button" className={`op-row prio-${i.priority}${isSel ? ' is-selected' : ''}${i.kind === 'sos' && newSos.has(i.sos.alert_id) ? ' is-new' : ''}${i.group === 'closed' ? ' is-closed' : ''}`}
        aria-current={isSel ? 'true' : undefined} onClick={() => pick(i.key)}>
        <span className="op-row-main"><strong>{title}</strong><span className="op-row-sub">{sub}</span></span>
        <span className="op-row-side">{pill}<span className="op-row-age">{elapsed(i.at)}</span></span>
      </button>
    </li>
  }

  function sosDraftSeed(a: IntakeSos): Partial<Draft> {
    return { barangay: String(a.barangay_id), resident: a.resident_uid, source: 'sos', sourceRef: a.alert_id,
      sosLevel: a.alert_level, sosNote: a.note ?? '', sosHeadcount: a.headcount,
      visitingFrom: a.home_barangay_id != null && a.home_barangay_id !== a.barangay_id ? (a.home_barangay_name ?? `Barangay ${a.home_barangay_id}`) : null,
      sentFrom: a.barangay_name ?? barangayName(a.barangay_id), subject: `SOS: ${a.alert_type ?? 'assistance'} — ${a.resident_name}`,
      lat: a.latitude != null ? String(a.latitude) : '', lng: a.longitude != null ? String(a.longitude) : '' }
  }
  const smallMap = (lat: unknown, lng: unknown) => lat != null && lng != null && lat !== '' && lng !== ''
    ? <div className="op-map"><TicketLocationMap latitude={String(lat)} longitude={String(lng)} fixed onChange={() => { /* view only */ }} /></div> : null
  const seeOnMap = (lat: unknown, lng: unknown, label: string) => showOnMap && lat != null && lng != null && lat !== '' && lng !== ''
    ? <button type="button" className="secondary-button" onClick={() => showOnMap({ lat: Number(lat), lng: Number(lng), label })}>See on map</button> : null

  function renderSosDetail(a: IntakeSos) {
    return <>
      <div className="op-detail-head">
        <h3>{a.resident_name} <span className={`prio-badge prio-${sosPriority(a)}`}>SOS{a.alert_level ? ` level ${a.alert_level}` : ''}</span>{notVerifiedTag(a.resident_uid)}
          {outsideCordova(a.latitude, a.longitude) && <> <span className="prio-badge prio-high">Outside Cordova</span></>}</h3>
        <p className="dispatch-muted">{a.alert_type ?? 'SOS'} · {a.barangay_name ?? barangayName(a.barangay_id)} · sent {elapsed(a.created_at)} ago</p>
      </div>
      <div className="op-detail-body">
        <SosResidentCard residentUid={a.resident_uid} resident={residentById.get(a.resident_uid)} headcount={a.headcount} note={a.note ?? ''}
          visitingFrom={a.home_barangay_id != null && a.home_barangay_id !== a.barangay_id ? (a.home_barangay_name ?? `Barangay ${a.home_barangay_id}`) : null}
          sentFrom={a.barangay_name ?? barangayName(a.barangay_id)} outsideCordova={outsideCordova(a.latitude, a.longitude)} />
        {smallMap(a.latitude, a.longitude)}
      </div>
      <button type="button" className="op-next" disabled={busy}
        onClick={() => { void loadWithMembers(a.alert_id); openDraft(sosDraftSeed(a)) }}>Create ticket and send a team</button>
      <div className="op-small">{seeOnMap(a.latitude, a.longitude, a.resident_name)}</div>
    </>
  }

  function renderTicketDetail(t: DispatchTicket) {
    const unit = unitById(t.assigned_unit_id)
    const resident = t.resident_uid ? residentById.get(t.resident_uid) : undefined
    const next = nextStatus(t.status)
    const mine = action?.ticketId === t.ticket_id ? action : null
    const closed = columnOf(t.status) === 'closed'
    const unitOptions = rankUnits(ownUnits, t.equipment).filter(r => r.unit.unit_id !== t.assigned_unit_id)
    const teamAsked = teamAskOf(t)
    const canAsk = !isSuper && !teamAsked && t.status === 'open'
    const sosNote = t.source === 'sos' && t.source_ref ? sosNotes.get(t.source_ref) : undefined
    const start = (kind: NonNullable<Action>['kind']) => setAction({ ticketId: t.ticket_id, kind, note: '',
      unit: kind === 'assign' || kind === 'reassign' ? String(unitOptions[0]?.unit.unit_id ?? '') : '' })
    // The one big button: the next step for this request.
    let big: ReactNode = null
    if (!closed && !mine) {
      if (t.status === 'open') {
        big = unitOptions.length
          ? <button type="button" className="op-next" disabled={busy} onClick={() => start('assign')}>Assign a team</button>
          : canAsk ? <button type="button" className="op-next" disabled={busy} onClick={() => start('askTeam')}>Ask the municipality for a team</button>
          : <p className="op-next-note">{teamAsked && !isSuper ? 'Waiting for the municipality to send a team.' : 'No free team right now. Add or free up a team on the Responder teams page.'}</p>
      } else big = <button type="button" className="op-next" disabled={busy} onClick={() => start('resolve')}>Resolve</button>
    }
    return <>
      <div className="op-detail-head">
        <h3>{ticketLabel(t)} · {ticketName(t)} <span className={`prio-badge prio-${t.priority}`}>{PRIORITY_LABELS[t.priority]}</span>
          <span className={`status-badge st-${t.status}`}>{STATUS_LABELS[t.status]}</span></h3>
        <p className="dispatch-muted">{SOURCE_LABELS[t.source]} · {barangayName(t.barangay_id)} · opened {elapsed(t.created_at)} ago{t.created_by_name ? ` by ${t.created_by_name}` : ''}</p>
      </div>
      <div className="op-detail-body">
        <dl className="op-facts">
          {sosNote && <><dt>Resident says</dt><dd>"{sosNote}"</dd></>}
          <dt>What is needed</dt><dd>{t.subject}</dd>
          {resident && <><dt>Resident</dt><dd>{resident.name}{resident.sitio ? ` · Sitio ${resident.sitio}` : ''}{resident.mobilityStatus ? ` · ${resident.mobilityStatus.replace('_', '-')}` : ''}</dd></>}
          {t.location_note && <><dt>Landmark</dt><dd>{t.location_note}</dd></>}
          {t.equipment.length > 0 && <><dt>Bring</dt><dd className="ticket-equip">{t.equipment.map(e => <span key={e}>{e}</span>)}</dd></>}
          {t.instructions && <><dt>Instructions</dt><dd className="ticket-instr">{t.instructions}</dd></>}
          {unit && <><dt>Team</dt><dd><strong>{unit.unit_name}</strong>{unit.borrowed ? ' (sent by the municipality)' : unit.members.length ? ` — ${unit.members.map(m => m.name).join(', ')}` : ' — no members'}
            {t.assigned_at ? ` · assigned ${elapsed(t.assigned_at)} ago` : ''}</dd></>}
          {closed && t.outcome_note && <><dt>{t.status === 'resolved' ? 'Outcome' : 'Canceled'}</dt><dd>{t.outcome_note} · {fmt(t.closed_at)}</dd></>}
        </dl>
        {smallMap(t.latitude, t.longitude)}
      </div>
      {teamAsked && (isSuper
        ? <div className="ticket-backup" role="alert"><span><strong>{barangayName(t.barangay_id)} asks for a team</strong>
            {' '}· asked {elapsed(teamAsked.requested_at)} ago{teamAsked.requested_by_name ? ` by ${teamAsked.requested_by_name}` : ''}{teamAsked.note ? ` — ${teamAsked.note}` : ''}. Sending a team answers it.</span></div>
        : <div className="ticket-waiting" role="status"><span><strong>Waiting for a team from the municipality</strong> · asked {elapsed(teamAsked.requested_at)} ago</span>
            <button type="button" className="link-button" disabled={busy}
              onClick={() => void run(() => closeBackupRequest(teamAsked.request_id, 'cancel'), `Request for a team on ${ticketLabel(t)} taken back.`)}>Take back</button></div>)}
      {otherBackupsOf(t).map(b => <div key={b.request_id} className="ticket-backup" role="alert">
        <span><strong>Backup needed: {BACKUP_NEED_LABELS[b.need] ?? b.need}</strong>
          {' '}· asked {elapsed(b.requested_at)} ago{b.requested_by_name ? ` by ${b.requested_by_name}` : ''}{b.note ? ` — ${b.note}` : ''}</span>
        <button type="button" className="verify-button" disabled={busy}
          onClick={() => void run(() => closeBackupRequest(b.request_id, 'handled'), `Backup for ${ticketLabel(t)} marked as sent.`)}>Mark sent</button>
      </div>)}

      {big}
      {mine && <form className="ticket-action-form" onSubmit={e => {
        e.preventDefault()
        if (mine.kind === 'askTeam') void run(() => requestTeam(t.ticket_id, mine.note), `Asked the municipality for a team for ${ticketLabel(t)}.`)
        else if (mine.kind === 'assign' || mine.kind === 'reassign') void run(() => assignDispatchTicket(t.ticket_id, Number(mine.unit), mine.note), `${ticketLabel(t)} assigned to ${unitById(Number(mine.unit))?.unit_name}.`)
        else if (mine.kind === 'resolve') void run(() => updateDispatchStatus(t.ticket_id, 'resolved', mine.note), `${ticketLabel(t)} resolved.`)
        else if (t.status === 'open') void run(() => cancelOpenDispatchTicket(t.ticket_id, mine.note), `${ticketLabel(t)} canceled.`)
        else void run(() => updateDispatchStatus(t.ticket_id, 'cancelled', mine.note), `${ticketLabel(t)} canceled.`)
      }}>
        <h4>{({ assign: 'Assign a team', reassign: 'Send a different team', resolve: 'Resolve this request', cancel: 'Cancel this request', askTeam: 'Ask the municipality for a team' } as const)[mine.kind]}</h4>
        {(mine.kind === 'assign' || mine.kind === 'reassign') && <label>Responder team
          <select value={mine.unit} onChange={e => setAction({ ...mine, unit: e.target.value })}>
            {unitOptions.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>
              {r.unit.unit_name} · {r.unit.live_tickets} live{t.equipment.length ? ` · has ${r.covered}/${t.equipment.length} equipment` : ''}{r.unit.members.length ? '' : ' · no members'}</option>)}
          </select></label>}
        {mine.kind === 'askTeam' && <p className="dispatch-muted">The municipal admin sees this right away and sends a team from another barangay. You will see the team's name and progress here.</p>}
        <label>{mine.kind === 'askTeam' ? 'Note for the municipality (optional), e.g. "Our team is busy, 3 people, water rising"' : mine.kind === 'resolve' ? 'Outcome (required)' : mine.kind === 'cancel' ? 'Reason (required), e.g. "Not a real emergency"' : mine.kind === 'reassign' && t.status !== 'assigned' ? 'Reason for changing teams (required)' : 'Note (optional)'}
          <textarea rows={2} maxLength={1000} value={mine.note} onChange={e => setAction({ ...mine, note: e.target.value })}
            required={mine.kind !== 'assign' && mine.kind !== 'askTeam' && !(mine.kind === 'reassign' && t.status === 'assigned')} /></label>
        <div className="ticket-actions">
          <button type="submit" className="verify-button" disabled={busy}>{busy ? 'Saving…' : mine.kind === 'askTeam' ? 'Send request' : 'Confirm'}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setAction(null)}>Back</button>
        </div>
      </form>}

      <div className="op-small">
        {!closed && !mine && <>
          {canAsk && unitOptions.length > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={() => start('askTeam')}>Ask the municipality for a team</button>}
          {next && <button type="button" className="secondary-button" disabled={busy} title="Normally updated by the team from the app"
            onClick={() => void run(() => updateDispatchStatus(t.ticket_id, next, ''), `${ticketLabel(t)} marked ${STATUS_LABELS[next].toLowerCase()}.`)}>Mark {STATUS_LABELS[next].toLowerCase()}</button>}
          {t.status !== 'open' && <button type="button" className="secondary-button" disabled={busy || !unitOptions.length} onClick={() => start('reassign')}>Send a different team</button>}
          <button type="button" className="secondary-button" disabled={busy} onClick={() => start('cancel')}>Cancel request</button>
        </>}
        {seeOnMap(t.latitude, t.longitude, ticketLabel(t))}
        <button type="button" className="secondary-button" onClick={async () => {
          if (history?.ticketId === t.ticket_id) { setHistory(null); return }
          try { setHistory({ ticketId: t.ticket_id, rows: await getDispatchTicketHistory(t.ticket_id) }) } catch (e) { setError(e instanceof Error ? e.message : 'History failed.') }
        }}>{history?.ticketId === t.ticket_id ? 'Hide history' : 'History'}</button>
      </div>
      {history?.ticketId === t.ticket_id && <ol className="ticket-history">{history.rows.map((h, i) => <li key={i}>
        <span>{fmt(h.recorded_at)}</span> {h.action}{h.to_status ? ` → ${STATUS_LABELS[h.to_status as keyof typeof STATUS_LABELS] ?? h.to_status}` : ''}
        {h.unit_name ? ` (${h.unit_name})` : ''}{h.actor_name ? ` · ${h.actor_name}` : ''}{h.note ? ` — ${h.note}` : ''}</li>)}</ol>}
    </>
  }

  function renderDraft(d: Draft, b: DispatchBoard) {
    return <>
      <div className="op-detail-head"><h3>{d.source === 'sos' ? `Create ticket: ${d.subject.replace(/^SOS: .*? — /, '')}` : 'New rescue request'}</h3>
        <p className="dispatch-muted">Check the details, pick a team, then press the green button.</p></div>
      <form onSubmit={e => void submitDraft(e)}>
        <fieldset className="dispatch-form" disabled={busy}>
          {d.source === 'sos' && d.resident && <div className="wide"><SosResidentCard residentUid={d.resident} resident={residentById.get(d.resident)}
            headcount={d.sosHeadcount} note={d.sosNote} visitingFrom={d.visitingFrom} sentFrom={d.sentFrom} withMembers={d.withMembers}
            outsideCordova={outsideCordova(d.lat, d.lng)} /></div>}
          <label>Barangay<select value={d.barangay} disabled={d.source !== 'manual'} onChange={e => setDraft({ ...d, barangay: e.target.value, resident: '', event: '' })}>
            {b.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select></label>
          <label>Disaster event (optional)<select value={d.event} onChange={e => setDraft({ ...d, event: e.target.value })}>
            <option value="">None</option>{b.events.filter(ev => String(ev.barangay_id) === d.barangay).map(ev => <option key={ev.event_id} value={ev.event_id}>{ev.name}</option>)}</select></label>
          {d.source !== 'sos' && <label className="wide">Resident (optional)<select value={d.resident} onChange={e => pickResident(e.target.value)}>
            <option value="">No specific resident</option>{draftResidents.map(r => <option key={r.id} value={r.id}>{r.name}{r.mobilityStatus ? ` · ${r.mobilityStatus.replace('_', '-')}` : ''}</option>)}</select></label>}
          {d.source !== 'sos' && <label className="wide">What is needed<input required maxLength={200} value={d.subject} onChange={e => setDraft({ ...d, subject: e.target.value })} placeholder="e.g. Evacuate bedridden elder, Purok 2" /></label>}
          <label>Priority<select value={d.priority} onChange={e => setDraft({ ...d, priority: e.target.value as TicketPriority })}>
            {(['critical', 'high', 'normal'] as const).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select>
            {draftSuggestion && draftSuggestion.reasons.length > 0 && <small className="dispatch-muted">Suggested {PRIORITY_LABELS[draftSuggestion.priority]}: {draftSuggestion.reasons.join(', ')}</small>}</label>
          <label>Team to send<select value={d.unit} onChange={e => setDraft({ ...d, unit: e.target.value })}>
            <option value="">No team yet</option>
            {ranked.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>{r.unit.unit_name} · {r.unit.live_tickets} live{d.equipment.length ? ` · has ${r.covered}/${d.equipment.length}` : ''}</option>)}</select>
            {!ranked.length && <small className="dispatch-muted">{isSuper ? 'No active team yet.' : 'No team of yours is active. Create the ticket, then ask the municipality for a team.'}</small>}</label>
          <div className="wide"><span className="dispatch-label">Where to go</span>
            <TicketLocationMap latitude={d.lat} longitude={d.lng} fixed={d.source === 'sos'}
              home={(() => { const r = residentById.get(d.resident); const la = Number(r?.gpsLat), lo = Number(r?.gpsLong)
                return r && r.gpsLat != null && Number.isFinite(la) && Number.isFinite(lo) && la !== 0 ? { lat: la, lng: lo } : null })()}
              onChange={(lat, lng) => setDraft((x) => (x ? { ...x, lat, lng } : x))} /></div>
          <label className="wide">Location / landmark<input maxLength={500} value={d.locationNote} onChange={e => setDraft({ ...d, locationNote: e.target.value })} /></label>
          <div className="wide"><span className="dispatch-label">Equipment to bring</span>
            <div className="dispatch-checks">{[...new Set([...EQUIPMENT_OPTIONS, ...d.equipment])].map(eq => <label key={eq} className="dispatch-chip">
              <input type="checkbox" checked={d.equipment.includes(eq)} onChange={e => setDraft({ ...d, equipment: e.target.checked ? [...d.equipment, eq] : d.equipment.filter(x => x !== eq) })} />{eq}</label>)}</div>
            {draftSuggestion && draftSuggestion.equipmentReasons.length > 0 && <ul className="equip-reasons">
              {draftSuggestion.equipmentReasons.map(n => <li key={n.equipment}><strong>{n.equipment}</strong> — {n.reasons.join('; ')}</li>)}</ul>}
            <small className="dispatch-muted">Pre-filled from the resident's profile (mobility, disabilities, pregnancy, age, household members). Responders confirm on site.</small></div>
          <label className="wide">Instructions for the team<textarea rows={3} maxLength={2000} value={d.instructions} onChange={e => setDraft({ ...d, instructions: e.target.value })} /></label>
          <div className="wide">
            <button type="submit" className="op-next">{busy ? 'Saving…' : d.unit ? 'Create ticket and send this team' : 'Create ticket'}</button>
            <div className="op-small"><button type="button" className="secondary-button" onClick={() => setDraft(null)}>Discard</button></div>
          </div>
        </fieldset>
      </form>
    </>
  }

  const COUNTERS: { key: Group | 'backup'; label: string; n: number; tone?: string }[] = [
    { key: 'sos', label: 'Needs a ticket', n: counts.sos, tone: counts.sos ? 'bad' : '' },
    { key: 'waiting', label: 'Waiting for a team', n: counts.waiting, tone: counts.waiting ? 'warn' : '' },
    { key: 'moving', label: 'Team on the way', n: counts.moving },
    { key: 'backup', label: 'Backup asked', n: backupTickets.size, tone: backupTickets.size ? 'bad' : '' },
    { key: 'closed', label: 'Closed (7 days)', n: counts.closed },
  ]
  const freeTeams = ownUnits.filter(u => u.is_active && u.live_tickets === 0).length

  return <div className="dispatch-page">
    <section className="panel dispatch-top">
      <div className="dispatch-head">
        <div><h3>{tab === 'units' ? 'Responder teams' : 'Rescue requests'}</h3>
          <p className="dispatch-muted">{tab === 'units'
            ? 'Teams that can be sent to a rescue request. Members see their team\'s rescues in the app.'
            : 'Every SOS and rescue in one list, most urgent first. Pick one to see the details and its next step.'}</p></div>
        <div className="ticket-actions">
          {tab === 'board' && <button type="button" className="primary-button" disabled={!board || busy} onClick={() => { setSel(null); openDraft() }}>+ New request</button>}
          <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => void load()}>Refresh</button>
        </div>
      </div>
      {board && tab === 'board' && <>
        <div className="op-counters" role="group" aria-label="Show only">
          {COUNTERS.map(c => <button key={c.key} type="button" className={`op-counter${groupFilter === c.key ? ' is-on' : ''}`}
            aria-pressed={groupFilter === c.key} onClick={() => toggleGroup(c.key)}>
            <strong className={c.tone}>{c.n}</strong><span>{c.label}</span></button>)}
        </div>
        <div className="op-toolbar">
          <input type="search" className="op-search" placeholder="Search name, ticket #, barangay or sitio…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search rescue requests" />
          {board.barangays.length > 1 && <select value={brgyFilter} onChange={e => setBrgyFilter(e.target.value)} aria-label="Barangay">
            <option value="">All barangays</option>{board.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select>}
          <select value={prioFilter} onChange={e => setPrioFilter(e.target.value as TicketPriority | '')} aria-label="Priority">
            <option value="">Any priority</option>{(['critical', 'high', 'normal'] as const).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select>
          <span className="dispatch-muted">{freeTeams} free team{freeTeams === 1 ? '' : 's'}</span>
        </div>
      </>}
      {error && <p role="alert" className="dispatch-error">{error}</p>}
      {notice && <p role="status" className="dispatch-notice">{notice}</p>}
      {loading && <p role="status">Loading rescue requests…</p>}
    </section>

    {board && tab === 'board' && <>
      <div className="op-split">
        <section className="panel op-list" aria-label="Rescue requests">
          {groups.map(g => {
            if (g.key === 'closed') return <div key={g.key}>
              <button type="button" className="op-group op-group-toggle" aria-expanded={showClosed} onClick={() => setClosedOpen(o => !o)}>
                {g.title} ({g.list.length}) {showClosed ? '▾' : '▸'}</button>
              {showClosed && <ul>{g.list.map(renderRow)}</ul>}
            </div>
            if (!g.list.length && groupFilter !== g.key) return null
            return <div key={g.key}>
              <h4 className="op-group">{g.title} ({g.list.length})</h4>
              {g.list.length ? <ul>{g.list.map(renderRow)}</ul> : <p className="dispatch-muted op-empty">Nothing here right now.</p>}
            </div>
          })}
          {!shown.length && <p className="dispatch-muted op-empty">{items.length ? 'Nothing matches the search or filters.' : 'No SOS or rescue requests right now.'}</p>}
        </section>

        <section className="panel op-detail" ref={detailRef} aria-live="polite">
          {draft ? renderDraft(draft, board)
            : selected?.kind === 'sos' ? renderSosDetail(selected.sos)
            : selected?.kind === 'ticket' ? renderTicketDetail(selected.t)
            : <p className="dispatch-muted op-empty">Pick a request on the left to see its details.</p>}
        </section>
      </div>

      {missingCount > 0 && <p className="dispatch-muted missing-hint">
        {missingCount} missing-person report{missingCount === 1 ? ' is' : 's are'} open on the{' '}
        {onOpenMissing ? <button type="button" className="link-button" onClick={onOpenMissing}>Missing persons tab</button> : 'Missing persons tab'}.
        To send a search team, use New request.</p>}

      {!!board.away_sos?.length && <section className="panel">
        <h3>Your residents in other barangays</h3>
        <p className="dispatch-muted">These residents raised an SOS outside your barangay, so that barangay dispatches it. Shown here so you can help with family contacts and household details.</p>
        <div className="intake-list">
          {board.away_sos.map(a => <article key={a.alert_id} className="intake-item">
            <div><span className="prio-badge prio-critical">SOS {a.alert_level ?? ''}</span> <strong>{a.resident_name}</strong>{notVerifiedTag(a.resident_uid)}
              <div className="dispatch-muted">{a.alert_type ?? 'alert'} · in {a.barangay_name}{a.headcount ? ` · ${a.headcount} ${a.headcount === 1 ? 'person' : 'people'}` : ''} · {elapsed(a.created_at)} ago</div></div>
            <span className={`status-badge st-${a.ticket_status ?? 'open'}`}>{a.ticket_status ? `${STATUS_LABELS[a.ticket_status]}${a.unit_name ? ` · ${a.unit_name}` : ''}` : 'Awaiting dispatch'}</span>
          </article>)}
        </div>
      </section>}
    </>}

