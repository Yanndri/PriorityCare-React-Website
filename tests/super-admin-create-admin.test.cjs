// Exercises the real prioritycare-api/server.js route handlers for
// GET /api/super-admin/dashboard, POST /api/super-admin/admins and
// PATCH /api/super-admin/admins/:uid
// with in-memory stand-ins for Express, Supabase, MySQL, and dotenv.
// No network or database is touched.
//
// Run: node --test tests/super-admin-create-admin.test.cjs

const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

// ---------- in-memory Supabase ----------
const SUPER = '11111111-1111-4111-8111-111111111111'
const SUSPENDED_SUPER = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'

const state = {
  tokens: {
    'super-token': SUPER,
    'suspended-token': SUSPENDED_SUPER,
    'admin-token': ADMIN,
  },
  authUsers: new Map(),
  users: [],
  sitios: [
    { sitio_id: 1, sitio_name: 'Alpha' },
    { sitio_id: 2, sitio_name: 'Bravo' },
  ],
  failNextProfileInsert: null,
  deletedAuthUsers: [],
  bans: [],
  failNextBan: false,
}

function resetState() {
  state.authUsers = new Map([
    [SUPER, { id: SUPER, email: 'super@example.com' }],
    [SUSPENDED_SUPER, { id: SUSPENDED_SUPER, email: 'old@example.com' }],
    [ADMIN, { id: ADMIN, email: 'admin@example.com' }],
  ])
  state.users = [
    { uid: SUPER, role: 'super_admin', account_status: 'active', email: 'super@example.com', f_name: 'S', l_name: 'A', contact_no: '09170000001', assigned_sitio_id: null },
    { uid: SUSPENDED_SUPER, role: 'super_admin', account_status: 'suspended', email: 'old@example.com', f_name: 'O', l_name: 'S', contact_no: '09170000002', assigned_sitio_id: null },
    { uid: ADMIN, role: 'admin', account_status: 'active', email: 'admin@example.com', f_name: 'A', l_name: 'D', contact_no: '09170000003', assigned_sitio_id: 1 },
  ]
  state.failNextProfileInsert = null
  state.deletedAuthUsers = []
  state.bans = []
  state.failNextBan = false
}

function pick(row, cols) {
  if (!cols || cols === '*') return { ...row }
  const out = {}
  for (const c of cols.split(',').map((s) => s.trim())) out[c] = row[c] ?? null
  return out
}

function from(table) {
  const q = { table, filters: [], cols: '*', insertRow: null, updateRow: null, order: null }
  const rows = () => (table === 'users' ? state.users : state.sitios)
  const run = () => {
    if (q.insertRow) {
      if (state.failNextProfileInsert) {
        const err = state.failNextProfileInsert
        state.failNextProfileInsert = null
        return { data: null, error: err }
      }
      const r = q.insertRow
      for (const k of ['uid', 'email', 'contact_no']) {
        if (state.users.some((u) => u[k] === r[k])) {
          return { data: null, error: { code: '23505', message: `duplicate ${k}` } }
        }
      }
      if (!['active', 'suspended'].includes(r.account_status)) {
        return { data: null, error: { code: '23514', message: 'check' } }
      }
      if (!state.sitios.some((s) => s.sitio_id === r.assigned_sitio_id)) {
        return { data: null, error: { code: '23503', message: 'fk' } }
      }
      state.users.push({ ...r })
      return { data: [pick(r, q.cols)], error: null }
    }
    if (q.updateRow) {
      const hit = rows().filter((r) => q.filters.every(([c, v]) => r[c] === v))
      for (const r of hit) Object.assign(r, q.updateRow)
      return { data: hit.map((r) => pick(r, q.cols)), error: null }
    }
    let out = rows().filter((r) => q.filters.every(([c, v]) => r[c] === v))
    if (q.order) out = [...out].sort((a, b) => String(a[q.order]).localeCompare(String(b[q.order])))
    return { data: out.map((r) => pick(r, q.cols)), error: null }
  }
  const builder = {
    select(cols) { q.cols = cols; return builder },
    eq(c, v) { q.filters.push([c, v]); return builder },
    order(c) { q.order = c; return builder },
    insert(row) { q.insertRow = row; return builder },
    update(row) { q.updateRow = row; return builder },
    async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
    async single() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
    then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
  }
  return builder
}

const fakeSupabase = {
  from,
  auth: {
    async getUser(token) {
      const id = state.tokens[token]
      return id
        ? { data: { user: state.authUsers.get(id) }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } }
    },
    admin: {
      lastCreateArgs: null,
      async createUser(args) {
        fakeSupabase.auth.admin.lastCreateArgs = args
        for (const u of state.authUsers.values()) {
          if (u.email === args.email) {
            return { data: { user: null }, error: { code: 'email_exists', message: 'exists' } }
          }
        }
        const id = args.id ?? require('node:crypto').randomUUID()
        const user = { id, email: args.email }
        state.authUsers.set(id, user)
        return { data: { user }, error: null }
      },
      async updateUserById(id, attrs) {
        if (state.failNextBan) {
          state.failNextBan = false
          return { data: { user: null }, error: { message: 'auth unavailable' } }
        }
        state.bans.push([id, attrs.ban_duration])
        return { data: { user: state.authUsers.get(id) }, error: null }
      },
      async deleteUser(id) {
        state.authUsers.delete(id)
        state.deletedAuthUsers.push(id)
        return { data: {}, error: null }
      },
    },
  },
}

// ---------- fake Express ----------
const routes = []
function fakeExpress() {
  const app = {
    use() {},
    get(p, ...h) { routes.push({ method: 'GET', path: p, handlers: h }) },
    post(p, ...h) { routes.push({ method: 'POST', path: p, handlers: h }) },
    patch(p, ...h) { routes.push({ method: 'PATCH', path: p, handlers: h }) },
    listen() {},
  }
  return app
}
fakeExpress.json = () => () => {}

const stubs = {
  express: fakeExpress,
  cors: () => () => {},
  'mysql2/promise': { createPool: () => ({}) },
  dotenv: { config() {} },
  '@supabase/supabase-js': { createClient: () => fakeSupabase },
}
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (Object.hasOwn(stubs, request)) return stubs[request]
  return realLoad.call(this, request, ...rest)
}
process.env.SUPABASE_URL = 'https://stub.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key'
const quietError = console.error
console.error = () => {}
require(path.join(__dirname, '..', 'prioritycare-api', 'server.js'))

function matchRoute(pattern, actual) {
  const p = pattern.split('/'), a = actual.split('/')
  if (p.length !== a.length) return null
  const params = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i])
    else if (p[i] !== a[i]) return null
  }
  return params
}

async function call(method, routePath, { token, body } = {}) {
  let params = null
  const route = routes.find((r) => r.method === method && (params = matchRoute(r.path, routePath)))
  assert.ok(route, `route ${method} ${routePath} registered`)
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, body, params }
  const res = {
    statusCode: 200, body: undefined, headersSent: false,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; this.headersSent = true; return this },
  }
  for (const h of route.handlers) {
    let advanced = false
    await h(req, res, () => { advanced = true })
    if (!advanced) break
  }
  return res
}

const valid = () => ({
  email: 'New.Admin@Example.com',
  password: 'S3cure-pass',
  f_name: 'Nina',
  m_name: '',
  l_name: 'Reyes',
  contact_no: '09171234567',
  assigned_sitio_id: 2,
})

test.beforeEach(resetState)
test.after(() => { console.error = quietError })

test('rejects requests without a token (401)', async () => {
  const res = await call('POST', '/api/super-admin/admins', { body: valid() })
  assert.equal(res.statusCode, 401)
  assert.equal(state.authUsers.size, 3)
})

test('rejects an invalid token (401)', async () => {
  const res = await call('POST', '/api/super-admin/admins', { token: 'forged', body: valid() })
  assert.equal(res.statusCode, 401)
})

test('rejects a regular admin calling the API directly (403)', async () => {
  const res = await call('POST', '/api/super-admin/admins', { token: 'admin-token', body: valid() })
  assert.equal(res.statusCode, 403)
  assert.equal(state.users.length, 3)
})

test('rejects a suspended super admin (403)', async () => {
  const res = await call('POST', '/api/super-admin/admins', { token: 'suspended-token', body: valid() })
  assert.equal(res.statusCode, 403)
})

test('server-side validation rejects bad input with 400 and creates nothing', async () => {
  const cases = [
    { email: '' },
    { email: 'not-an-email' },
    { password: 'short' },
    { password: 'x'.repeat(73) },
    { f_name: '   ' },
    { l_name: undefined },
    { contact_no: '' },
    { contact_no: 'abc1234567' },
    { contact_no: '123' },
    { f_name: 'x'.repeat(101) },
    { m_name: 42 },
    { assigned_sitio_id: '' },
    { assigned_sitio_id: 'abc' },
    { assigned_sitio_id: -1 },
    { assigned_sitio_id: 99 }, // does not exist
    { uid: 'not-a-uuid' },
  ]
  for (const patch of cases) {
    const res = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: { ...valid(), ...patch } })
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(patch)}; got ${res.statusCode} ${res.body?.message}`)
    assert.equal(typeof res.body.message, 'string')
  }
  assert.equal(state.authUsers.size, 3)
  assert.equal(state.users.length, 3)
})

test('creates Auth user + admin profile with correct role, sitio, and status', async () => {
  const res = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: valid() })
  assert.equal(res.statusCode, 201, res.body?.message)
  const args = fakeSupabase.auth.admin.lastCreateArgs
  assert.equal(args.email, 'new.admin@example.com')
  assert.equal(args.email_confirm, true)

  const profile = state.users.find((u) => u.email === 'new.admin@example.com')
  assert.ok(profile)
  assert.equal(profile.role, 'admin')
  assert.equal(profile.assigned_sitio_id, 2)
  assert.equal(profile.account_status, 'active')
  assert.equal(profile.m_name, null)
  assert.ok(state.authUsers.has(profile.uid), 'profile uid matches Auth user id')

  const text = JSON.stringify(res.body)
  assert.ok(!text.includes('S3cure-pass'), 'password not echoed')
  assert.ok(!text.includes('stub-service-role-key'), 'service key not echoed')
  assert.ok(!text.includes('super-token'), 'token not echoed')
  assert.equal(res.body.admin.uid, profile.uid)

  const dash = await call('GET', '/api/super-admin/dashboard', { token: 'super-token' })
  assert.equal(dash.statusCode, 200)
  assert.equal(dash.body.admins.length, 2, 'new admin appears in dashboard list')
  assert.equal(dash.body.admins.filter((a) => a.assigned_sitio_id === 2).length, 1)
  assert.equal(dash.body.sitios.length, 2)
})

test('honours an optional custom UUID', async () => {
  const uid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const res = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: { ...valid(), uid } })
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.admin.uid, uid)
  const dup = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: { ...valid(), email: 'x@example.com', contact_no: '09179999999', uid } })
  assert.equal(dup.statusCode, 409)
})

test('duplicate email or contact number returns 409 and creates nothing', async () => {
  let res = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: { ...valid(), email: 'admin@example.com' } })
  assert.equal(res.statusCode, 409)
  res = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: { ...valid(), contact_no: '09170000003' } })
  assert.equal(res.statusCode, 409)
  assert.equal(state.authUsers.size, 3)
})

test('rolls back the Auth user when the profile insert fails (500)', async () => {
  state.failNextProfileInsert = { code: '42501', message: 'permission denied' }
  const res = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: valid() })
  assert.equal(res.statusCode, 500)
  assert.equal(state.deletedAuthUsers.length, 1)
  assert.equal(state.authUsers.size, 3, 'no orphaned Auth user')
  assert.equal(state.users.length, 3)
})

test('race on a unique column returns 409 and rolls back the Auth user', async () => {
  state.failNextProfileInsert = { code: '23505', message: 'duplicate key' }
  const res = await call('POST', '/api/super-admin/admins', { token: 'super-token', body: valid() })
  assert.equal(res.statusCode, 409)
  assert.equal(state.authUsers.size, 3)
})

test('dashboard is also super-admin only', async () => {
  assert.equal((await call('GET', '/api/super-admin/dashboard')).statusCode, 401)
  assert.equal((await call('GET', '/api/super-admin/dashboard', { token: 'admin-token' })).statusCode, 403)
})

// ---------- PATCH /api/super-admin/admins/:uid ----------
const adminPath = (uid = ADMIN) => `/api/super-admin/admins/${uid}`
const adminRow = () => state.users.find((u) => u.uid === ADMIN)

test('manage admin: only an active super admin may call it', async () => {
  assert.equal((await call('PATCH', adminPath(), { body: { account_status: 'suspended' } })).statusCode, 401)
  assert.equal((await call('PATCH', adminPath(), { token: 'forged', body: { account_status: 'suspended' } })).statusCode, 401)
  assert.equal((await call('PATCH', adminPath(), { token: 'admin-token', body: { account_status: 'suspended' } })).statusCode, 403)
  assert.equal((await call('PATCH', adminPath(), { token: 'suspended-token', body: { account_status: 'suspended' } })).statusCode, 403)
  assert.equal(adminRow().account_status, 'active')
  assert.equal(state.bans.length, 0)
})

test('manage admin: suspend bans sign-in, reactivate restores it', async () => {
  let res = await call('PATCH', adminPath(), { token: 'super-token', body: { account_status: 'suspended' } })
  assert.equal(res.statusCode, 200, res.body?.message)
  assert.equal(adminRow().account_status, 'suspended')
  assert.deepEqual(state.bans, [[ADMIN, '876000h']])
  assert.match(res.body.message, /suspended/)

  res = await call('PATCH', adminPath(), { token: 'super-token', body: { account_status: 'active' } })
  assert.equal(res.statusCode, 200)
  assert.equal(adminRow().account_status, 'active')
  assert.deepEqual(state.bans.at(-1), [ADMIN, 'none'])
  assert.match(res.body.message, /reactivated/)
})

test('manage admin: reassigns the sitio without touching sign-in', async () => {
  const res = await call('PATCH', adminPath(), { token: 'super-token', body: { assigned_sitio_id: 2 } })
  assert.equal(res.statusCode, 200)
  assert.equal(adminRow().assigned_sitio_id, 2)
  assert.equal(res.body.admin.assigned_sitio_id, 2)
  assert.equal(state.bans.length, 0)
})

test('manage admin: rejects bad input and protected accounts', async () => {
  const bad = [
    [adminPath('not-a-uuid'), { account_status: 'suspended' }, 400],
    [adminPath(), {}, 400],
    [adminPath(), { role: 'super_admin' }, 400],
    [adminPath(), { account_status: 'suspended', role: 'super_admin' }, 400],
    [adminPath(), { account_status: 'deleted' }, 400],
    [adminPath(), { assigned_sitio_id: 99 }, 400],
    [adminPath(), { assigned_sitio_id: 'abc' }, 400],
    [adminPath(SUPER), { account_status: 'suspended' }, 400], // own account
    [adminPath(SUSPENDED_SUPER), { account_status: 'active' }, 404], // a super admin
    [adminPath('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), { account_status: 'suspended' }, 404],
  ]
  for (const [p, body, status] of bad) {
    const res = await call('PATCH', p, { token: 'super-token', body })
    assert.equal(res.statusCode, status, `${p} ${JSON.stringify(body)} -> ${res.statusCode} ${res.body?.message}`)
  }
  assert.equal(adminRow().account_status, 'active')
  assert.equal(adminRow().assigned_sitio_id, 1)
  assert.equal(adminRow().role, 'admin')
  assert.equal(state.users.find((u) => u.uid === SUSPENDED_SUPER).account_status, 'suspended')
  assert.equal(state.bans.length, 0)
})

test('manage admin: if Auth cannot be updated, the profile change is undone', async () => {
  state.failNextBan = true
  const res = await call('PATCH', adminPath(), { token: 'super-token', body: { account_status: 'suspended', assigned_sitio_id: 2 } })
  assert.equal(res.statusCode, 500)
  assert.equal(adminRow().account_status, 'active')
  assert.equal(adminRow().assigned_sitio_id, 1)
})

// ---------- startup key check ----------
test('server refuses to start with the publishable key or a non-service JWT', () => {
  const { spawnSync } = require('node:child_process')
  const jwt = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.')
  const boot = (key) => spawnSync(process.execPath, ['-e', `
    const Module = require('node:module'); const real = Module._load
    const stubs = { express: Object.assign(() => ({ use(){}, get(){}, post(){}, patch(){}, listen(){} }), { json: () => () => {} }),
      cors: () => () => {}, 'mysql2/promise': { createPool: () => ({}) }, dotenv: { config() {} },
      '@supabase/supabase-js': { createClient: () => ({}) } }
    Module._load = function (r, ...a) { return Object.hasOwn(stubs, r) ? stubs[r] : real.call(this, r, ...a) }
    try { require(${JSON.stringify(path.join(__dirname, '..', 'prioritycare-api', 'server.js'))}); console.log('STARTED') }
    catch (e) { console.log('REFUSED: ' + e.message) }`],
  { env: { ...process.env, SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key }, encoding: 'utf8' })

  const cases = [
    ['sb_publishable_x', /REFUSED: .*publishable/],
    [jwt({ role: 'anon', ref: 'abcd' }), /REFUSED: .*'anon' key/],
    [jwt({ role: 'service_role', ref: 'other' }), /REFUSED: .*different Supabase project/],
    [jwt({ role: 'service_role', ref: 'abcd' }), /STARTED/],
    ['sb_secret_x', /STARTED/],
  ]
  for (const [key, expected] of cases) {
    const out = boot(key)
    assert.match(out.stdout, expected, out.stderr)
    assert.ok(!out.stdout.includes(key), 'key value is never printed')
  }
})

// ---------- legacy MySQL routes ----------
test('legacy resident routes are not public (401 / 403 for non-super-admins)', async () => {
  for (const p of ['/api/residents', '/api/map/residents', '/api/verification/pending', '/api/test-db']) {
    assert.equal((await call('GET', p)).statusCode, 401, `${p} without a token`)
    assert.equal((await call('GET', p, { token: 'forged' })).statusCode, 401, `${p} forged token`)
    assert.equal((await call('GET', p, { token: 'admin-token' })).statusCode, 403, `${p} as an Admin`)
    assert.equal((await call('GET', p, { token: 'suspended-token' })).statusCode, 403, `${p} as a suspended Super Admin`)
  }
})

test('health check stays public', async () => {
  const res = await call('GET', '/api/health')
  assert.equal(res.statusCode, 200)
})
