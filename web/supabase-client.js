// Inicializa el cliente de Supabase usando los valores de config.js
// (ver config.example.js para instrucciones).
if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || window.SUPABASE_URL.includes("TU-PROYECTO")) {
  document.addEventListener("DOMContentLoaded", function () {
    document.body.innerHTML =
      '<div style="max-width:480px;margin:80px auto;padding:24px;font-family:sans-serif;line-height:1.5;">' +
      '<h2>Falta configurar Supabase</h2>' +
      '<p>No se encontró <code>config.js</code> con los datos de tu proyecto. ' +
      'Copia <code>config.example.js</code> a <code>config.js</code> y pega ahí la ' +
      'Project URL y la anon key de tu proyecto de Supabase (Project Settings → API).</p>' +
      "</div>";
  });
  throw new Error("Falta config.js con SUPABASE_URL y SUPABASE_ANON_KEY");
}

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

/**
 * Devuelve la sesión activa, o null si no hay nadie autenticado.
 */
async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

/**
 * Carga el perfil (fila de "residentes") del usuario autenticado.
 */
async function getMyProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabaseClient
    .from("residentes")
    .select("*")
    .eq("id", session.user.id)
    .single();
  if (error) {
    console.error("Error cargando perfil:", error);
    return null;
  }
  return data;
}

/**
 * Protege una página: si no hay sesión, regresa a index.html.
 * Si hay sesión, devuelve { session, profile }.
 */
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  const profile = await getMyProfile();
  return { session, profile };
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}

const TIPO_OCUPACION_LABEL = {
  propietario: "Propietario",
  arrendatario: "Arrendatario",
  posesion_irregular: "Posesión irregular",
};
