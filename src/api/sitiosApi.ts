import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Official sitio list per barangay (STEP14). Staff keep it here; residents pick from it in the app.
export type Sitio = { sitio_id: number; barangay_id: number; sitio_name: string }

function sitioError(error: { code?: string; message: string }) {
  if (error.code === '42P01' || error.code === 'PGRST205') return new Error('The sitio list needs database step 14.')
  if (error.code === '23505') return new Error('That sitio is already on the list.')
  return new Error(error.message)
}

export async function listSitios(barangayId: number | null): Promise<Sitio[]> {
  let query = supabase.from('sitios').select('sitio_id, barangay_id, sitio_name').order('sitio_name')
  if (barangayId !== null) query = query.eq('barangay_id', barangayId)
  const { data, error } = await query
  if (error) throw sitioError(error)
  return (data ?? []) as Sitio[]
}

export async function addSitio(barangayId: number, name: string) {
  const { error } = await supabase.from('sitios').insert({ barangay_id: barangayId, sitio_name: name.trim() })
  if (error) throw sitioError(error)
}

// Also renames it on residents and households that use the old name (database function).
export async function renameSitio(sitioId: number, name: string) {
  const { error } = await supabase.rpc('rename_sitio', { p_sitio_id: sitioId, p_new_name: name.trim() })
  if (error) throw sitioError(error)
}

export async function removeSitio(sitioId: number) {
  const { error } = await supabase.from('sitios').delete().eq('sitio_id', sitioId)
  if (error) throw sitioError(error)
}

// Sitios for one barangay, reloadable. Empty when no barangay is chosen.
export function useSitios(barangayId: number | null) {
  const [sitios, setSitios] = useState<Sitio[]>([])
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    if (barangayId === null) { setSitios([]); return }
    try { setSitios(await listSitios(barangayId)); setError('') }
    catch (e) { setSitios([]); setError(e instanceof Error ? e.message : 'Unable to load sitios.') }
  }, [barangayId])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on barangay change
    void reload()
  }, [reload])
  return { sitios, error, reload }
}
