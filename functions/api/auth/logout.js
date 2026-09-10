export async function onRequestPost() {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  headers.append("Set-Cookie", "lh_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  headers.append("Set-Cookie", "lh_refresh=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return new Response(JSON.stringify({ ok: true }), { headers });
}
