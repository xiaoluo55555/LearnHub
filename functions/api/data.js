export async function onRequestGet({ request, env }) {
  const token = bearer(request);
  if (!token) return Response.json({ authenticated: false, state: null });
  const user = await supabaseUser(env, token);
  if (!user) return Response.json({ authenticated: false, state: null }, { status: 401 });
  const row = await supabaseGet(env, user.id, token);
  return Response.json({ authenticated: true, user: { id: user.id, email: user.email }, state: row?.state || null, updatedAt: row?.updated_at || null });
}

export async function onRequestPut({ request, env }) {
  const token = bearer(request);
  if (!token) return Response.json({ error: "Not authenticated." }, { status: 401 });
  const user = await supabaseUser(env, token);
  if (!user) return Response.json({ error: "Invalid session." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body.state || typeof body.state !== "object") return Response.json({ error: "Invalid state." }, { status: 400 });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/user_learning_state?on_conflict=user_id`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ user_id: user.id, state: body.state }) });
  if (!response.ok) return Response.json({ error: "Could not save state." }, { status: 502 });
  return Response.json({ ok: true, savedAt: new Date().toISOString() });
}

function bearer(request) { const cookie = request.headers.get("Cookie") || ""; const match = cookie.match(/(?:^|;\s*)lh_access=([^;]+)/); return match ? decodeURIComponent(match[1]) : (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""); }
async function supabaseUser(env, token) { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }); return r.ok ? r.json() : null; }
async function supabaseGet(env, userId, token) { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/user_learning_state?user_id=eq.${encodeURIComponent(userId)}&select=state,updated_at&limit=1`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }); const rows = r.ok ? await r.json() : []; return rows[0] || null; }
