export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return Response.json({ error: "Auth backend is not configured." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: body.email, password: body.password }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return Response.json({ error: data.error_description || data.msg || "Login failed." }, { status: response.status });
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  headers.append("Set-Cookie", `lh_access=${encodeURIComponent(data.access_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${data.expires_in || 3600}`);
  headers.append("Set-Cookie", `lh_refresh=${encodeURIComponent(data.refresh_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  return new Response(JSON.stringify({ user: data.user || null }), { headers });
}
