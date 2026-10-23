import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BriefcaseBusiness, Check, CheckCircle2, ClipboardCheck, FileSpreadsheet, Folder, FolderKanban, KeyRound, LayoutGrid, Link2, LockKeyhole, LogOut, Menu, Pencil, Plus, Search, ShieldCheck, Tag, Trash2, UserPlus, Users, Wrench, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './services/supabase'

type LinkItem = { id: string; title: string; url?: string; displayHost: string; description: string; category: string; categoryId: string }
type Profile = { id: string; username: string | null; display_name: string; role: 'member' | 'admin'; active: boolean; created_at?: string }
type AdminUser = Profile & { categoryIds: string[] }
type AccessMode = 'link' | 'admin' | 'login'

const USER_DOMAIN = 'usuarios.turismoconecta.app'
const normalizeUsername = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '.')
const loginEmail = (value: string) => {
  const clean = value.trim().toLowerCase()
  return clean.includes('@') ? clean : normalizeUsername(clean) + '@' + USER_DOMAIN
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [links, setLinks] = useState<LinkItem[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [members, setMembers] = useState<AdminUser[]>([])
  const [adminOpen, setAdminOpen] = useState(false)
  const [linkEditor, setLinkEditor] = useState<LinkItem | null | 'new'>(null)
  const [accessMode, setAccessMode] = useState<AccessMode | null>(null)
  const [pendingLink, setPendingLink] = useState<LinkItem | null>(null)
  const [deniedLink, setDeniedLink] = useState<LinkItem | null>(null)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('Todos')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }

  const loadAll = async (currentSession: Session | null) => {
    const [publicResult, categoryResult] = await Promise.all([
      supabase.rpc('list_public_links'),
      supabase.from('categories').select('id,name').order('name'),
    ])
    if (categoryResult.error) throw categoryResult.error
    setCategories((categoryResult.data ?? []) as { id: string; name: string }[])

    let publicRows = (publicResult.data ?? []) as any[]
    if (publicResult.error) {
      const fallback = await supabase.from('links').select('id,title,url,description,category_id,categories(name)').order('created_at', { ascending: false })
      if (fallback.error) throw fallback.error
      publicRows = (fallback.data ?? []) as any[]
    }
    let nextLinks: LinkItem[] = publicRows.map((row) => ({
      id: row.id,
      title: row.title,
      displayHost: row.display_host || (row.url ? new URL(row.url).hostname : 'Enlace protegido'),
      description: row.description ?? '',
      categoryId: row.category_id,
      category: row.category_name || row.categories?.name || 'Otros',
    }))
    if (!currentSession) {
      setLinks(nextLinks)
      setProfile(null)
      setPermissions([])
      return
    }
    const [profileResult, permissionResult] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,role,active,created_at').eq('id', currentSession.user.id).single(),
      supabase.from('user_category_permissions').select('category_id').eq('user_id', currentSession.user.id),
    ])
    if (profileResult.error) throw profileResult.error
    const currentProfile = profileResult.data as Profile
    setProfile(currentProfile)
    setPermissions(permissionResult.error ? [] : (permissionResult.data ?? []).map((row: { category_id: string }) => row.category_id))
    if (currentProfile.role === 'admin') {
      const adminLinks = await supabase.from('links').select('id,url')
      if (!adminLinks.error) {
        const urls = new Map((adminLinks.data ?? []).map((row: { id: string; url: string }) => [row.id, row.url]))
        nextLinks = nextLinks.map((link) => ({ ...link, url: urls.get(link.id) }))
      }
    }
    setLinks(nextLinks)
  }

  const loadMembers = async () => {
    const [profileResult, permissionResult] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,role,active,created_at').order('created_at', { ascending: false }),
      supabase.from('user_category_permissions').select('user_id,category_id'),
    ])
    if (profileResult.error || permissionResult.error) {
      notify('No se pudieron cargar los usuarios')
      return
    }
    const rows = (permissionResult.data ?? []) as { user_id: string; category_id: string }[]
    setMembers(((profileResult.data ?? []) as Profile[]).map((item) => ({
      ...item,
      categoryIds: rows.filter((row) => row.user_id === item.id).map((row) => row.category_id),
    })))
  }

  useEffect(() => {
    let active = true
    const start = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (!active) return
        setSession(data.session)
        await loadAll(data.session)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'No se pudo conectar con Supabase')
      } finally {
        if (active) setLoading(false)
      }
    }
    void start()
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setProfile(null)
        setPermissions([])
        setAdminOpen(false)
      }
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const visibleLinks = useMemo(() => links.filter((link) => {
    const text = [link.title, link.description, link.displayHost].join(' ').toLowerCase()
    return text.includes(search.toLowerCase()) && (activeCategory === 'Todos' || link.category === activeCategory)
  }), [links, search, activeCategory])

  const canOpen = (link: LinkItem, userProfile = profile, allowed = permissions) => Boolean(
    userProfile?.active && (userProfile.role === 'admin' || allowed.includes(link.categoryId)),
  )

  const fetchDestination = async (linkId: string) => {
    const { data, error: destinationError } = await supabase.rpc('get_link_destination', { requested_link_id: linkId })
    if (destinationError || !data) throw new Error('No tienes permiso para abrir este enlace.')
    return String(data)
  }

  const requestLink = async (link: LinkItem) => {
    if (!session || !profile) {
      setPendingLink(link)
      setAccessMode('link')
    } else if (!canOpen(link)) {
      setDeniedLink(link)
    } else {
      const popup = window.open('about:blank', '_blank')
      try {
        const destination = await fetchDestination(link.id)
        if (popup) popup.location.href = destination
        else window.location.assign(destination)
      } catch (reason) {
        popup?.close()
        notify(reason instanceof Error ? reason.message : 'No se pudo abrir el enlace')
      }
    }
  }

  const authenticated = async (nextSession: Session, mode: AccessMode) => {
    setSession(nextSession)
    await loadAll(nextSession)
    const [profileResult, permissionResult] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,role,active,created_at').eq('id', nextSession.user.id).single(),
      supabase.from('user_category_permissions').select('category_id').eq('user_id', nextSession.user.id),
    ])
    if (profileResult.error) throw profileResult.error
    const nextProfile = profileResult.data as Profile
    const nextPermissions = (permissionResult.data ?? []).map((row: { category_id: string }) => row.category_id)
    setProfile(nextProfile)
    setPermissions(nextPermissions)
    if (!nextProfile.active) throw new Error('Tu usuario está desactivado.')
    if (mode === 'login') {
      setAccessMode(null)
      notify('Sesión iniciada correctamente')
      return
    }
    if (mode === 'admin') {
      if (nextProfile.role !== 'admin') throw new Error('Esta cuenta no es administradora.')
      setAccessMode(null)
      setAdminOpen(true)
      await loadMembers()
      return
    }
    if (pendingLink) {
      if (!(nextProfile.role === 'admin' || nextPermissions.includes(pendingLink.categoryId))) {
        setAccessMode(null)
        setDeniedLink(pendingLink)
        setPendingLink(null)
        return
      }
      const target = await fetchDestination(pendingLink.id)
      setAccessMode(null)
      setPendingLink(null)
      window.location.assign(target)
    }
  }

  const openAdmin = async () => {
    if (profile?.role === 'admin') {
      setAdminOpen(true)
      await loadMembers()
    } else {
      setPendingLink(null)
      setAccessMode('admin')
    }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
    setPermissions([])
    notify('Sesión cerrada')
  }

  const saveLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session || profile?.role !== 'admin') return
    const form = new FormData(event.currentTarget)
    const url = String(form.get('url') ?? '').trim()
    try { new URL(url) } catch { notify('Escribe una URL válida'); return }
    const categoryId = String(form.get('categoryId') ?? '')
    const payload = {
      title: String(form.get('title') ?? '').trim(),
      url,
      normalized_url: url.toLowerCase().replace(/\/$/, ''),
      description: String(form.get('description') ?? '').trim(),
      category_id: categoryId,
      updated_at: new Date().toISOString(),
    }
    const result = linkEditor === 'new'
      ? await supabase.from('links').insert({ ...payload, created_by: session.user.id, revision: 1 })
      : await supabase.from('links').update({ ...payload, revision: 2 }).eq('id', linkEditor?.id)
    if (result.error) notify('No se pudo guardar el enlace')
    else {
      setLinkEditor(null)
      await loadAll(session)
      notify(linkEditor === 'new' ? 'Enlace creado' : 'Enlace actualizado')
    }
  }

  const deleteLink = async (id: string) => {
    if (profile?.role !== 'admin' || !window.confirm('¿Eliminar este enlace?')) return
    const result = await supabase.from('links').delete().eq('id', id)
    if (result.error) notify('No se pudo eliminar el enlace')
    else {
      setLinks((old) => old.filter((link) => link.id !== id))
      notify('Enlace eliminado')
    }
  }

  if (loading) return <div className="center-screen"><Brand /><p>Conectando con Supabase...</p></div>
  if (adminOpen && profile?.role === 'admin' && session) return <AdminPanel members={members} categories={categories} currentUserId={session.user.id} onBack={() => setAdminOpen(false)} onRefresh={loadMembers} notify={notify} />

  return <div className="app-shell">
    <header className="topbar">
      <img className="institution-logo logo-left" src="/logos/unidad-sistemas-turismo-header-v2.png" alt="Unidad de Sistemas - Carrera de Turismo" />
      <Brand />
      <img className="institution-logo logo-right" src="/logos/turismo.png" alt="Turismo" />
      <button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menú"><Menu /></button>
      <div className="top-actions">
        {!session && <button className="admin-entry login-entry" onClick={() => { setPendingLink(null); setAccessMode('login') }}><KeyRound size={15} /> Iniciar sesión</button>}
        {profile?.role === 'admin' && <button className="admin-entry" onClick={() => void openAdmin()}><ShieldCheck size={15} /> Administrar</button>}
        <div className="avatar">{profile ? profile.display_name.slice(0, 2).toUpperCase() : 'VI'}</div>
        <div className="user-copy"><strong>{profile?.username || 'Visitante'}</strong><small>{profile?.role === 'admin' ? 'Administrador' : profile ? 'Usuario autorizado' : 'Acceso público'}</small></div>
        {session && <button className="icon-button" title="Cerrar sesión" onClick={() => void logout()}><LogOut size={17} /></button>}
      </div>
    </header>
    <div className={'layout ' + (mobileMenu ? 'menu-open' : '')}>
      <aside className="sidebar">
        <div className="sidebar-title">Tu espacio</div>
        <button className="nav-item active"><LayoutGrid size={18} /> Directorio <span className="count">{links.length}</span></button>
        <div className="sidebar-divider" />
        <div className="sidebar-title category-heading">Categorías</div>
        {categories.map((category) => <button key={category.id} className="nav-item category-link" onClick={() => { setActiveCategory(category.name); setMobileMenu(false) }}><span className="category-dot" />{category.name}<span className="count">{links.filter((link) => link.categoryId === category.id).length}</span></button>)}
        {!session && <div className="sidebar-bottom"><button className="admin-entry sidebar-admin-button sidebar-login-button" onClick={() => { setPendingLink(null); setAccessMode('login'); setMobileMenu(false) }}><KeyRound size={17} /> Iniciar sesión</button></div>}
        {profile?.role === 'admin' && <div className="sidebar-bottom"><button className="admin-entry sidebar-admin-button" onClick={() => void openAdmin()}><ShieldCheck size={17} /> Administrar usuarios</button></div>}
      </aside>
      <main className="content">
        <div className="content-header"><div className="content-header-copy"><div className="eyebrow"><Folder size={15} /> Espacio compartido</div><h1>Directorio de enlaces</h1><p>Todos pueden ver los enlaces. Para abrirlos necesitas una cuenta autorizada.</p></div>{profile?.role === 'admin' && <div className="content-header-action"><button className="primary-button" onClick={() => setLinkEditor('new')}><Plus size={18} /> Agregar enlace</button></div>}</div>
        <section className="stats-row">
          <Stat icon={<Link2 size={19} />} color="green" label="Total de enlaces" value={links.length} />
          <Stat icon={<LockKeyhole size={19} />} color="yellow" label="Categorías permitidas" value={profile?.role === 'admin' ? categories.length : permissions.length} />
          <Stat icon={<Tag size={19} />} color="blue" label="Categorías" value={categories.length} />
        </section>
        <div className="toolbar"><div className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar enlaces, descripciones o dominios..." /></div><div className="filter-pills"><button className={activeCategory === 'Todos' ? 'pill active' : 'pill'} onClick={() => setActiveCategory('Todos')}>Todos</button>{categories.map((category) => <button key={category.id} className={activeCategory === category.name ? 'pill active' : 'pill'} onClick={() => setActiveCategory(category.name)}>{category.name}</button>)}</div></div>
        <div className="results-line"><span>{visibleLinks.length} enlaces encontrados</span><span>Acceso por usuario</span></div>
        <div className="link-grid">
          {visibleLinks.map((link) => <article className="link-card" key={link.id}>
            <div className="card-top"><div className="site-icon module-icon"><ModuleIcon link={link} /></div><div className="card-actions"><span className={'access-indicator ' + (canOpen(link) ? 'allowed' : '')}>{canOpen(link) ? <CheckCircle2 size={18} /> : <LockKeyhole size={18} />}</span>{profile?.role === 'admin' && <button className="more-button" onClick={() => setLinkEditor(link)}>•••</button>}</div></div>
            <div className="card-body module-button-area"><h2 className="module-title">{link.title}</h2><button className="domain protected-link module-entry-button" aria-label={`Ingresar a ${link.title}`} onClick={() => void requestLink(link)}>Ingresar al módulo</button></div>
            <div className="card-footer"><span className="tag"><Tag size={12} /> {link.category}</span><span className="author"><LockKeyhole size={12} /> Acceso protegido</span></div>
            {profile?.role === 'admin' && <div className="card-hover-actions"><button onClick={() => setLinkEditor(link)}>Editar</button><button onClick={() => void deleteLink(link.id)}><Trash2 size={14} /></button></div>}
          </article>)}
          {visibleLinks.length === 0 && <div className="empty-state"><Search size={30} /><h2>No hay resultados</h2><p>Prueba con otra búsqueda.</p></div>}
        </div>
        {error && <div className="demo-note">{error}</div>}
      </main>
    </div>
    {toast && <div className="toast"><Check size={17} /> {toast}</div>}
    {accessMode && <AccessModal mode={accessMode} target={pendingLink} onClose={() => { setAccessMode(null); setPendingLink(null) }} onAuthenticated={authenticated} />}
    {deniedLink && <DeniedModal link={deniedLink} profile={profile} onClose={() => setDeniedLink(null)} onChangeAccount={async () => { const target = deniedLink; setDeniedLink(null); await logout(); setPendingLink(target); setAccessMode('link') }} />}
    {linkEditor && profile?.role === 'admin' && <LinkModal editing={linkEditor === 'new' ? null : linkEditor} categories={categories} onClose={() => setLinkEditor(null)} onSubmit={saveLink} />}
  </div>
}

function Brand() { return <div className="brand"><span className="brand-mark"><Link2 size={20} /></span><span>Turismo<span className="brand-accent"> Conecta</span></span></div> }
function Stat({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: number }) { return <div className="stat-card"><div className={'stat-icon ' + color}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div> }
function ModuleIcon({ link }: { link: LinkItem }) {
  const source = `${link.title} ${link.category}`.toLowerCase()
  if (source.includes('lista') || source.includes('csv') || source.includes('reporte')) return <FileSpreadsheet size={22} strokeWidth={1.8} />
  if (source.includes('acta') || source.includes('document')) return <ClipboardCheck size={22} strokeWidth={1.8} />
  if (source.includes('manten') || source.includes('herramient')) return <Wrench size={22} strokeWidth={1.8} />
  if (source.includes('proyecto') || source.includes('sistema')) return <FolderKanban size={22} strokeWidth={1.8} />
  if (source.includes('turismo') || source.includes('servicio')) return <BriefcaseBusiness size={22} strokeWidth={1.8} />
  return <LayoutGrid size={22} strokeWidth={1.8} />
}

function AccessModal({ mode, target, onClose, onAuthenticated }: { mode: AccessMode; target: LinkItem | null; onClose: () => void; onAuthenticated: (session: Session, mode: AccessMode) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const result = await supabase.auth.signInWithPassword({ email: loginEmail(username), password })
    if (result.error || !result.data.session) {
      setMessage('Usuario o contraseña incorrectos.')
      setBusy(false)
      return
    }
    try {
      await onAuthenticated(result.data.session, mode)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No se pudo verificar el acceso.')
      await supabase.auth.signOut()
    } finally {
      setBusy(false)
    }
  }
  const title = mode === 'admin' ? 'Ingreso de administrador' : mode === 'login' ? 'Iniciar sesión' : 'Ingresar a ' + (target?.title ?? 'este enlace')
  const description = mode === 'admin'
    ? 'Ingresa con la cuenta administrativa. Las cuentas antiguas pueden usar su correo electrónico.'
    : mode === 'login'
      ? 'Inicia sesión para acceder a las categorías que te asignó el administrador.'
      : 'Ingresa el usuario y la contraseña asignados por el administrador.'
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal access-modal"><div className="modal-heading"><div><span className="eyebrow"><LockKeyhole size={14} /> Acceso protegido</span><h2>{title}</h2></div><button className="close-button" onClick={onClose}><X /></button></div><p className="modal-intro">{description}</p><form onSubmit={(event) => void submit(event)}><label>Usuario<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder={mode === 'admin' ? 'usuario o correo electrónico' : 'nombre.usuario'} required /></label><label>Contraseña<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>{message && <div className="form-message">{message}</div>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? 'Verificando...' : 'Ingresar'}</button></div></form></div></div>
}

function DeniedModal({ link, profile, onClose, onChangeAccount }: { link: LinkItem; profile: Profile | null; onClose: () => void; onChangeAccount: () => void }) {
  return <div className="modal-backdrop"><div className="modal access-modal denied-modal"><div className="denied-icon"><LockKeyhole /></div><h2>Acceso no autorizado</h2><p>La cuenta <strong>{profile?.username || profile?.display_name}</strong> no puede abrir <strong>{link.title}</strong>. El administrador debe habilitar la categoría <strong>{link.category}</strong>.</p><div className="form-actions"><button className="secondary-button" onClick={onClose}>Volver</button><button className="primary-button" onClick={onChangeAccount}>Cambiar de usuario</button></div></div></div>
}

function AdminPanel({ members, categories, currentUserId, onBack, onRefresh, notify }: { members: AdminUser[]; categories: { id: string; name: string }[]; currentUserId: string; onBack: () => void; onRefresh: () => Promise<void>; notify: (message: string) => void }) {
  const [editor, setEditor] = useState<AdminUser | 'new' | null>(null)
  return <div className="admin-page"><div className="admin-page-header"><button className="secondary-button" onClick={onBack}><ArrowLeft size={16} /> Volver al directorio</button><Brand /></div><div className="admin-content access-admin-content"><div className="admin-title-row"><div><div className="eyebrow"><ShieldCheck size={15} /> Administración</div><h1>Usuarios y permisos</h1><p>Crea cuentas y elige qué categorías puede abrir cada usuario.</p></div><button className="primary-button" onClick={() => setEditor('new')}><UserPlus size={17} /> Crear usuario</button></div><div className="permission-summary"><LockKeyhole size={20} /><div><strong>Acceso controlado</strong><span>Las tarjetas son públicas; su contenido requiere autorización.</span></div></div><div className="members-table access-members-table"><div className="member-row member-heading"><span>Usuario</span><span>Permisos</span><span>Estado</span><span>Acción</span></div>{members.map((member) => <div className="member-row" key={member.id}><div className="member-name"><div className="avatar small">{member.display_name.slice(0, 2).toUpperCase()}</div><div><strong>{member.username || member.display_name}</strong><small>{member.id === currentUserId ? 'Tu cuenta administrativa' : 'Cuenta de acceso'}</small></div></div><div className="permission-chips">{member.role === 'admin' ? <span className="permission-chip all">Todas</span> : member.categoryIds.length ? member.categoryIds.map((id) => <span className="permission-chip" key={id}>{categories.find((item) => item.id === id)?.name ?? 'Categoría'}</span>) : <span className="permission-chip none">Sin permisos</span>}</div><span className={member.active ? 'status active-status' : 'status pending-status'}>{member.active ? 'Activo' : 'Inactivo'}</span><button className={member.id === currentUserId ? 'member-action disabled' : 'member-action approve'} disabled={member.id === currentUserId} onClick={() => setEditor(member)}>{member.id === currentUserId ? 'Tu cuenta' : <><Pencil size={14} /> Editar</>}</button></div>)}</div>{members.length === 0 && <div className="empty-state"><Users size={30} /><p>No hay usuarios creados.</p></div>}</div>{editor && <UserEditor user={editor === 'new' ? null : editor} categories={categories} onClose={() => setEditor(null)} onSaved={async (message) => { setEditor(null); await onRefresh(); notify(message) }} />}</div>
}

function UserEditor({ user, categories, onClose, onSaved }: { user: AdminUser | null; categories: { id: string; name: string }[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [username, setUsername] = useState(user?.username || user?.display_name || '')
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<string[]>(user?.categoryIds ?? [])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const toggle = (id: string) => setSelected((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const { data, error } = await supabase.functions.invoke('manage-users', { body: { action: user ? 'update' : 'create', userId: user?.id, username: normalizeUsername(username), password, categoryIds: selected } })
    setBusy(false)
    if (error || data?.error) {
      setMessage(data?.error || error?.message || 'No se pudo guardar el usuario.')
      return
    }
    await onSaved(user ? 'Usuario y permisos actualizados' : 'Usuario creado correctamente')
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal user-editor"><div className="modal-heading"><div><span className="eyebrow"><KeyRound size={14} /> Control de acceso</span><h2>{user ? 'Editar usuario' : 'Crear usuario'}</h2></div><button className="close-button" onClick={onClose}><X /></button></div><form onSubmit={(event) => void submit(event)}><label>Nombre de usuario<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" autoComplete="off" required /><span>Letras, números, punto, guion o guion bajo.</span></label><label>{user ? 'Nueva contraseña (opcional)' : 'Contraseña'}<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={8} autoComplete="new-password" required={!user} /><span>{user ? 'Vacío conserva la contraseña actual.' : 'Mínimo 8 caracteres.'}</span></label><fieldset className="permission-fieldset"><legend>Categorías permitidas</legend>{categories.map((category) => <label className="permission-option" key={category.id}><input type="checkbox" checked={selected.includes(category.id)} onChange={() => toggle(category.id)} /><span><strong>{category.name}</strong><small>Podrá abrir los enlaces de esta categoría.</small></span></label>)}</fieldset>{message && <div className="form-message">{message}</div>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? 'Guardando...' : user ? 'Guardar cambios' : 'Crear usuario'}</button></div></form></div></div>
}

function LinkModal({ editing, categories, onClose, onSubmit }: { editing: LinkItem | null; categories: { id: string; name: string }[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal link-editor"><div className="modal-heading"><div><span className="eyebrow">{editing ? 'Editar enlace' : 'Nuevo enlace'}</span><h2>{editing ? 'Actualiza los datos' : 'Agrega un enlace'}</h2></div><button className="close-button" onClick={onClose}><X /></button></div><form onSubmit={onSubmit}><label>Título<input name="title" defaultValue={editing?.title} maxLength={120} required /></label><label>URL<input name="url" type="url" defaultValue={editing?.url} placeholder="https://" required /></label><label>Descripción <span>Opcional</span><textarea name="description" defaultValue={editing?.description} maxLength={500} /></label><label>Categoría<select name="categoryId" defaultValue={editing?.categoryId ?? categories[0]?.id} required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button">{editing ? 'Guardar cambios' : 'Agregar enlace'}</button></div></form></div></div>
}

export default App
