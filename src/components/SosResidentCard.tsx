import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Resident } from '../types/dashboard'
import { residentOnScene, residentVpi } from '../utils/householdVpi'

// Who sent the SOS, for the admin deciding what to send: how many people, who they are,
// how to reach them, and what the house looks like.

const MOBILITY: Record<string, string> = {
  ambulatory: 'can walk', semi_ambulatory: 'needs help walking', non_ambulatory: 'cannot walk',
  assisted: 'needs help walking', wheelchair: 'wheelchair', bedridden: 'bedridden',
}
const AGE: Record<string, string> = { infant: 'infant', child: 'child', adult: 'adult', senior: 'senior' }

type Extra = { contact: string | null; photoUrl: string | null }

export function SosResidentCard({ residentUid, resident, headcount, note, visitingFrom, sentFrom, withMembers }: {
  residentUid: string
  resident?: Resident
  headcount?: number | null
  note?: string
  visitingFrom?: string | null
  sentFrom?: string | null
  withMembers?: string[] | null
}) {
  const [extra, setExtra] = useState<Extra>({ contact: null, photoUrl: null })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data: u }, { data: r }] = await Promise.all([
        supabase.from('users').select('contact_no').eq('uid', residentUid).maybeSingle(),
        supabase.from('residents').select('house_photo_url').eq('uid', residentUid).maybeSingle(),
      ])
      let photoUrl: string | null = null
      if (r?.house_photo_url) {
        const { data } = await supabase.storage.from('house-facades').createSignedUrl(String(r.house_photo_url), 60 * 30)
        photoUrl = data?.signedUrl ?? null
      }
      if (!cancelled) setExtra({ contact: u?.contact_no ? String(u.contact_no) : null, photoUrl })
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [residentUid])

  const members = resident?.householdMembers ?? []
  // Priority counts only the people with the resident (the ones they ticked), not the whole household.
  const onScene = residentOnScene(resident, withMembers, !!visitingFrom)
  const vpi = onScene ? residentVpi(onScene) : null
  const people = headcount ?? (resident ? 1 + members.length : null)
  const isWith = (id?: string) => !withMembers || (!!id && withMembers.includes(id))
  const others = withMembers && people != null ? Math.max(0, people - 1 - withMembers.length) : 0

  return (
    <div className="sos-resident wide">
      <div className="sos-resident-main">
        {visitingFrom && <p className="sos-visiting"><strong>Visiting:</strong> registered in Brgy. {visitingFrom}, but the phone sent this SOS
          from {sentFrom ? `Brgy. ${sentFrom}` : 'another barangay'}. Their household below may not be with them, so go by "People" and what the resident says.</p>}
        <p className="sos-note"><strong>Resident says:</strong>{' '}
          {note ? `"${note}"` : <em className="dispatch-muted">No details given with this SOS.</em>}</p>
        <dl className="sos-resident-facts">
          <div><dt>People</dt><dd>{people ?? '—'}{people ? (people === 1 ? ' person' : ' people') : ''}</dd></div>
          <div><dt>Contact</dt><dd>{extra.contact ? <a href={`tel:${extra.contact}`}>{extra.contact}</a> : '—'}</dd></div>
          {resident?.emergencyContactNo && <div><dt>Emergency contact</dt><dd>{resident.emergencyContactName ? `${resident.emergencyContactName}: ` : ''}<a href={`tel:${resident.emergencyContactNo}`}>{resident.emergencyContactNo}</a></dd></div>}
          {resident && <div><dt>Home</dt><dd>{[resident.address, resident.sitio, `Brgy. ${resident.barangay}`].filter(Boolean).join(', ')}</dd></div>}
          {resident?.landmark && resident.landmark !== 'No landmark provided' && <div><dt>Landmark</dt><dd>{resident.landmark}</dd></div>}
          {resident?.houseType && !visitingFrom && <div><dt>House</dt><dd>{resident.houseType}</dd></div>}
          {vpi && <div><dt>Priority score</dt><dd>{vpi.score} ({vpi.priority})</dd></div>}
        </dl>
        {resident && (
          <>
            <strong className="sos-resident-head">{withMembers ? 'With the resident' : 'Household (the resident did not say who is with them)'}</strong>
            <ul className="sos-resident-people">
              <li>{resident.name} (account holder){resident.mobilityStatus ? ` · ${MOBILITY[resident.mobilityStatus] ?? resident.mobilityStatus}` : ''}{resident.isPregnant ? ' · pregnant' : ''}</li>
              {members.map((m, i) => <li key={m.member_id ?? i} className={isWith(m.member_id) ? undefined : 'sos-not-with'}>{!isWith(m.member_id) && 'Not with them: '}{m.name}{m.relationship ? ` (${m.relationship})` : ''}
                {m.age_group ? ` · ${AGE[m.age_group] ?? m.age_group}` : ''}{m.mobility ? ` · ${MOBILITY[m.mobility] ?? m.mobility}` : ''}{m.is_pregnant ? ' · pregnant' : ''}</li>)}
              {others > 0 && <li>{others} other {others === 1 ? 'person' : 'people'} not in the household</li>}
            </ul>
          </>
        )}
        {!resident && <p className="dispatch-muted">This resident is registered in another barangay, so only what they sent is shown.</p>}
      </div>
      {extra.photoUrl
        ? <img className="sos-resident-photo" src={extra.photoUrl} alt="Front of the house" />
        : <div className="sos-resident-photo sos-resident-nophoto">No house photo</div>}
    </div>
  )
}
