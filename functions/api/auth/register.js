export async function onRequestPost({ request, env }) {
  return supabaseAuth(request, env, "signup");
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

async function supabaseAuth(request, env, type) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "Auth backend is not configured." }, 503);
  const body = await request.json().catch(() => ({}));
  const endpoint = type === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
  const response = await fetch(`${env.SUPABASE_URL}${endpoint}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: data.msg || data.error_description || data.message || "Authentication failed." }, response.status);
  const headers = new Headers(cors());
  if (data.access_token) headers.append("Set-Cookie", `lh_access=${encodeURIComponent(data.access_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${data.expires_in || 3600}`);
  if (data.refresh_token) headers.append("Set-Cookie", `lh_refresh=${encodeURIComponent(data.refresh_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  return new Response(JSON.stringify({ user: data.user || null, needsEmailConfirmation: !data.access_token }), { status: 200, headers: withJson(headers) });
}

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: withJson(new Headers(cors())) }); }
function withJson(headers) { headers.set("Content-Type", "application/json; charset=utf-8"); return headers; }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }; }
