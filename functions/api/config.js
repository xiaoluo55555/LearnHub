export async function onRequestGet({ env }) {
  return Response.json({
    ok: true,
    app: "LearnHub",
    version: env.LEARNHUB_VERSION || "2026.09.10",
    syncEnabled: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    authEnabled: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY)
  });
}
