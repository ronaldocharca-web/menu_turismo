import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
)

const normalizeUsername = (value: string) => value.trim().toLowerCase()
const userEmail = (username: string) => username + '@usuarios.turismoconecta.app'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authorization = request.headers.get('Authorization')
    if (!supabaseUrl || !anonKey || !serviceKey || !authorization) return json({ error: 'Configuración de seguridad incompleta.' }, 500)

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: authData, error: authError } = await callerClient.auth.getUser()
    if (authError || !authData.user) return json({ error: 'Sesión no válida.' }, 401)
    const { data: caller } = await serviceClient.from('profiles').select('role,active').eq('id', authData.user.id).single()
    if (!caller?.active || caller.role !== 'admin') return json({ error: 'Solo el administrador puede gestionar usuarios.' }, 403)

    const payload = await request.json()
    const action = String(payload.action ?? '')
    const username = normalizeUsername(String(payload.username ?? ''))
    const password = String(payload.password ?? '')
    const categoryIds = Array.isArray(payload.categoryIds) ? [...new Set(payload.categoryIds.map(String))] : []
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ error: 'El usuario debe tener entre 3 y 32 caracteres válidos.' }, 400)
    if (action === 'create' && password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400)
    if (action === 'update' && password && password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400)

    let userId = String(payload.userId ?? '')
    const { data: duplicate } = await serviceClient
      .from('profiles')
      .select('id')
      .ilike('username', username)
      .neq('id', userId || '00000000-0000-0000-0000-000000000000')
      .maybeSingle()
    if (duplicate) return json({ error: 'Ese nombre de usuario ya está en uso.' }, 409)

    if (action === 'create') {
      const { data, error } = await serviceClient.auth.admin.createUser({
        email: userEmail(username),
        password,
        email_confirm: true,
        user_metadata: { username, display_name: username, managed_by_admin: true },
      })
      if (error || !data.user) return json({ error: error?.message || 'No se pudo crear el usuario.' }, 400)
      userId = data.user.id
      const { error: profileError } = await serviceClient.from('profiles').update({
        username, display_name: username, role: 'member', active: true,
      }).eq('id', userId)
      if (profileError) {
        await serviceClient.auth.admin.deleteUser(userId)
        return json({ error: profileError.message }, 400)
      }
    } else if (action === 'update') {
      if (!userId) return json({ error: 'Falta identificar al usuario.' }, 400)
      const updateData: { email: string; password?: string; user_metadata: Record<string, unknown> } = {
        email: userEmail(username),
        user_metadata: { username, display_name: username, managed_by_admin: true },
      }
      if (password) updateData.password = password
      const { error } = await serviceClient.auth.admin.updateUserById(userId, updateData)
      if (error) return json({ error: error.message }, 400)
      const { error: profileError } = await serviceClient.from('profiles').update({
        username, display_name: username, active: true,
      }).eq('id', userId)
      if (profileError) return json({ error: profileError.message }, 400)
    } else {
      return json({ error: 'Acción no válida.' }, 400)
    }

    const { error: deleteError } = await serviceClient.from('user_category_permissions').delete().eq('user_id', userId)
    if (deleteError) return json({ error: deleteError.message }, 400)
    if (categoryIds.length) {
      const { error: permissionError } = await serviceClient.from('user_category_permissions').insert(
        categoryIds.map((categoryId) => ({ user_id: userId, category_id: categoryId })),
      )
      if (permissionError) return json({ error: permissionError.message }, 400)
    }
    return json({ ok: true, userId })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500)
  }
})

