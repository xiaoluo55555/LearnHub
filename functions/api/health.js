export async function onRequestGet() {
  return Response.json({ ok: true, service: "learnhub-api", runtime: "cloudflare-pages-functions", now: new Date().toISOString() });
}
