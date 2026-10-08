let CURRENT_PROFILE = null;
let CURRENT_TAB = null;

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

async function init() {
  const auth = await requireAuth();
  if (!auth) return;
  const { profile } = auth;

  if (!profile) {
    document.getElementById("app").innerHTML =
      '<div class="card"><h2>No se encontró tu perfil</h2>' +
      '<p class="hint">Tu cuenta existe pero no tiene un registro en la tabla "residentes". ' +
      "Pide a un miembro del comité que revise tu alta.</p></div>";
    return;
  }

  CURRENT_PROFILE = profile;

  document.getElementById("userLabel").textContent =
    profile.nombre_completo + " · " + (profile.rol === "comite" ? "Comité" : "Residente");
  document.getElementById("logoutBtn").addEventListener("click", signOut);

  renderTabs();
  const firstTab = profile.rol === "comite" ? "padron" : "mis-visitas";
  switchTab(firstTab);
}

function renderTabs() {
  const isComite = CURRENT_PROFILE.rol === "comite";
  const tabs = isComite
    ? [
        ["padron", "Padrón de residentes"],
        ["visitas", "Control de visitas"],
        ["perfil", "Mi perfil"],
      ]
    : [
        ["mis-visitas", "Mis visitas"],
        ["perfil", "Mi perfil"],
      ];

  const tabsHtml =
    '<div class="tabs" id="tabsRow">' +
    tabs
      .map(
        ([key, label]) =>
          `<button class="tab-btn" data-tab="${key}">${label}</button>`
      )
      .join("") +
    "</div>";

  document.getElementById("app").innerHTML = tabsHtml + '<div id="tabContent"></div>';

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function setActiveTabButton(tab) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

function switchTab(tab) {
  CURRENT_TAB = tab;
  setActiveTabButton(tab);
  const content = document.getElementById("tabContent");
  content.innerHTML = '<div class="loading">Cargando…</div>';

  if (tab === "mis-visitas") return renderMisVisitas();
  if (tab === "padron") return renderPadron();
  if (tab === "visitas") return renderVisitasComite();
  if (tab === "perfil") return renderPerfil();
}

// ============================================================
// Tab: Mis visitas (residente normal)
// ============================================================
async function renderMisVisitas() {
  const content = document.getElementById("tabContent");

  const { data: visitas, error } = await supabaseClient
    .from("visitas")
    .select("*")
    .eq("residente_id", CURRENT_PROFILE.id)
    .order("entrada", { ascending: false })
    .limit(50);

  if (error) {
    content.innerHTML = `<div class="banner banner-error">No se pudieron cargar tus visitas: ${escapeHtml(error.message)}</div>`;
    return;
  }

  content.innerHTML = `
    <div class="card">
      <h2>Registrar visita</h2>
      <p class="hint">Domicilio: ${escapeHtml(CURRENT_PROFILE.domicilio)}</p>
      <div id="formBanner"></div>
      <form id="nuevaVisitaForm">
        <div class="form-row">
          <div>
            <label for="vNombre">Nombre del visitante</label>
            <input type="text" id="vNombre" required>
          </div>
          <div>
            <label for="vPlacas">Vehículo / placas (opcional)</label>
            <input type="text" id="vPlacas">
          </div>
        </div>
        <label for="vMotivo">Motivo (opcional)</label>
        <input type="text" id="vMotivo" placeholder="Ej. visita familiar, entrega, servicio">
        <button type="submit" class="btn btn-primary">Registrar entrada</button>
      </form>
    </div>
    <div class="card">
      <h2>Historial</h2>
      <div id="visitasTableWrap"></div>
    </div>
  `;

  renderVisitasTable(visitas, { showDomicilio: false, canClose: true });

  document.getElementById("nuevaVisitaForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const visitante_nombre = document.getElementById("vNombre").value.trim();
    const vehiculo_placas = document.getElementById("vPlacas").value.trim();
    const motivo = document.getElementById("vMotivo").value.trim();

    const { error: insErr } = await supabaseClient.from("visitas").insert({
      residente_id: CURRENT_PROFILE.id,
      visitante_nombre,
      vehiculo_placas: vehiculo_placas || null,
      motivo: motivo || null,
      registrado_por: CURRENT_PROFILE.id,
    });

    const banner = document.getElementById("formBanner");
    if (insErr) {
      banner.innerHTML = `<div class="banner banner-error">No se pudo registrar: ${escapeHtml(insErr.message)}</div>`;
      return;
    }
    banner.innerHTML = "";
    renderMisVisitas();
  });
}

// ============================================================
// Tabla de visitas reutilizable
// ============================================================
function renderVisitasTable(visitas, opts) {
  const wrap = document.getElementById("visitasTableWrap");
  if (!visitas || visitas.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Todavía no hay visitas registradas.</div>';
    return;
  }

  const rows = visitas
    .map((v) => {
      const abierta = !v.salida;
      const domicilioCol = opts.showDomicilio
        ? `<td data-label="Domicilio">${escapeHtml(v.domicilio || "")}</td>`
        : "";
      const accionCol = opts.canClose
        ? `<td data-label="Acción">${
            abierta
              ? `<button class="btn btn-secondary" data-close-visita="${v.id}" style="padding:6px 12px; font-size:12px;">Marcar salida</button>`
              : "—"
          }</td>`
        : "";
      return `
        <tr>
          <td data-label="Visitante">${escapeHtml(v.visitante_nombre)}</td>
          ${domicilioCol}
          <td data-label="Vehículo">${escapeHtml(v.vehiculo_placas || "—")}</td>
          <td data-label="Motivo">${escapeHtml(v.motivo || "—")}</td>
          <td data-label="Entrada">${formatDateTime(v.entrada)}</td>
          <td data-label="Salida">${abierta ? '<span class="pill pill-abierta">En curso</span>' : formatDateTime(v.salida)}</td>
          ${accionCol}
        </tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Visitante</th>
          ${opts.showDomicilio ? "<th>Domicilio</th>" : ""}
          <th>Vehículo</th>
          <th>Motivo</th>
          <th>Entrada</th>
          <th>Salida</th>
          ${opts.canClose ? "<th></th>" : ""}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-close-visita]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-close-visita");
      btn.disabled = true;
      const { error } = await supabaseClient
        .from("visitas")
        .update({ salida: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        alert("No se pudo marcar la salida: " + error.message);
        btn.disabled = false;
        return;
      }
      switchTab(CURRENT_TAB);
    });
  });
}

// ============================================================
// Tab: Padrón de residentes (solo comité)
// ============================================================
async function renderPadron() {
  const content = document.getElementById("tabContent");

  const { data: residentes, error } = await supabaseClient
    .from("residentes")
    .select("*")
    .order("domicilio", { ascending: true });

  if (error) {
    content.innerHTML = `<div class="banner banner-error">No se pudo cargar el padrón: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const rows = residentes
    .map(
      (r) => `
      <tr>
        <td data-label="Nombre">${escapeHtml(r.nombre_completo)}</td>
        <td data-label="Domicilio">${escapeHtml(r.domicilio)}</td>
        <td data-label="Teléfono">${escapeHtml(r.telefono || "—")}</td>
        <td data-label="Ocupación">
          <select class="inline-select" data-field="tipo_ocupacion" data-id="${r.id}">
            <option value="propietario" ${r.tipo_ocupacion === "propietario" ? "selected" : ""}>Propietario</option>
            <option value="arrendatario" ${r.tipo_ocupacion === "arrendatario" ? "selected" : ""}>Arrendatario</option>
            <option value="posesion_irregular" ${r.tipo_ocupacion === "posesion_irregular" ? "selected" : ""}>Posesión irregular</option>
          </select>
        </td>
        <td data-label="Rol">
          <select class="inline-select" data-field="rol" data-id="${r.id}">
            <option value="residente" ${r.rol === "residente" ? "selected" : ""}>Residente</option>
            <option value="comite" ${r.rol === "comite" ? "selected" : ""}>Comité</option>
          </select>
        </td>
      </tr>`
    )
    .join("");

  content.innerHTML = `
    <div class="card">
      <h2>Padrón de residentes</h2>
      <p class="hint">La ocupación y el rol son visibles solo para el comité. Cambia el valor en la lista para actualizarlo al instante.</p>
      <div id="padronBanner"></div>
      <table>
        <thead>
          <tr><th>Nombre</th><th>Domicilio</th><th>Teléfono</th><th>Ocupación</th><th>Rol</th></tr>
        </thead>
        <tbody>${rows || ""}</tbody>
      </table>
      ${residentes.length === 0 ? '<div class="empty-state">Todavía no hay residentes registrados.</div>' : ""}
    </div>
  `;

  content.querySelectorAll("select[data-field]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-id");
      const field = sel.getAttribute("data-field");
      const value = sel.value;
      const { error: updErr } = await supabaseClient
        .from("residentes")
        .update({ [field]: value })
        .eq("id", id);
      const banner = document.getElementById("padronBanner");
      if (updErr) {
        banner.innerHTML = `<div class="banner banner-error">No se pudo actualizar: ${escapeHtml(updErr.message)}</div>`;
      } else {
        banner.innerHTML = '<div class="banner banner-ok">Actualizado.</div>';
        setTimeout(() => (banner.innerHTML = ""), 2500);
      }
    });
  });
}

// ============================================================
// Tab: Control de visitas (todas, solo comité)
// ============================================================
async function renderVisitasComite() {
  const content = document.getElementById("tabContent");

  const [{ data: residentes, error: resErr }, { data: visitasRaw, error: visErr }] = await Promise.all([
    supabaseClient.from("residentes").select("id, nombre_completo, domicilio").order("domicilio"),
    supabaseClient.from("visitas").select("*").order("entrada", { ascending: false }).limit(100),
  ]);

  if (resErr || visErr) {
    content.innerHTML = `<div class="banner banner-error">No se pudo cargar la información: ${escapeHtml((resErr || visErr).message)}</div>`;
    return;
  }

  const residentesById = {};
  residentes.forEach((r) => (residentesById[r.id] = r));

  const visitas = visitasRaw.map((v) => ({
    ...v,
    domicilio: residentesById[v.residente_id] ? residentesById[v.residente_id].domicilio : "—",
  }));

  const opciones = residentes
    .map((r) => `<option value="${r.id}">${escapeHtml(r.domicilio)} — ${escapeHtml(r.nombre_completo)}</option>`)
    .join("");

  content.innerHTML = `
    <div class="card">
      <h2>Registrar visita</h2>
      <div id="formBanner"></div>
      <form id="nuevaVisitaComiteForm">
        <label for="cResidente">Domicilio que recibe la visita</label>
        <select id="cResidente" required>
          <option value="" disabled selected>Selecciona un domicilio</option>
          ${opciones}
        </select>
        <div class="form-row">
          <div>
            <label for="cNombre">Nombre del visitante</label>
            <input type="text" id="cNombre" required>
          </div>
          <div>
            <label for="cPlacas">Vehículo / placas (opcional)</label>
            <input type="text" id="cPlacas">
          </div>
        </div>
        <label for="cMotivo">Motivo (opcional)</label>
        <input type="text" id="cMotivo">
        <button type="submit" class="btn btn-primary">Registrar entrada</button>
      </form>
    </div>
    <div class="card">
      <h2>Todas las visitas</h2>
      <div id="visitasTableWrap"></div>
    </div>
  `;

  renderVisitasTable(visitas, { showDomicilio: true, canClose: true });

  document.getElementById("nuevaVisitaComiteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const residente_id = document.getElementById("cResidente").value;
    const visitante_nombre = document.getElementById("cNombre").value.trim();
    const vehiculo_placas = document.getElementById("cPlacas").value.trim();
    const motivo = document.getElementById("cMotivo").value.trim();

    const { error: insErr } = await supabaseClient.from("visitas").insert({
      residente_id,
      visitante_nombre,
      vehiculo_placas: vehiculo_placas || null,
      motivo: motivo || null,
      registrado_por: CURRENT_PROFILE.id,
    });

    const banner = document.getElementById("formBanner");
    if (insErr) {
      banner.innerHTML = `<div class="banner banner-error">No se pudo registrar: ${escapeHtml(insErr.message)}</div>`;
      return;
    }
    renderVisitasComite();
  });
}

// ============================================================
// Tab: Mi perfil
// ============================================================
async function renderPerfil() {
  const content = document.getElementById("tabContent");
  const p = CURRENT_PROFILE;
  const isComite = p.rol === "comite";

  content.innerHTML = `
    <div class="card">
      <h2>Mi perfil</h2>
      <div id="perfilBanner"></div>
      <form id="perfilForm">
        <label for="pNombre">Nombre completo</label>
        <input type="text" id="pNombre" value="${escapeHtml(p.nombre_completo)}" required>

        <label for="pTelefono">Teléfono</label>
        <input type="tel" id="pTelefono" value="${escapeHtml(p.telefono || "")}">

        <label for="pDomicilio">Domicilio</label>
        <input type="text" id="pDomicilio" value="${escapeHtml(p.domicilio)}" ${isComite ? "" : "disabled"}>

        <button type="submit" class="btn btn-primary">Guardar cambios</button>
      </form>
      <p class="hint" style="margin-top:16px;">
        Tipo de ocupación: <span class="pill pill-${p.tipo_ocupacion}">${TIPO_OCUPACION_LABEL[p.tipo_ocupacion] || p.tipo_ocupacion}</span>
        ${isComite ? "" : " — solo el comité puede cambiar este dato."}
      </p>
    </div>
  `;

  document.getElementById("perfilForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const update = {
      nombre_completo: document.getElementById("pNombre").value.trim(),
      telefono: document.getElementById("pTelefono").value.trim() || null,
    };
    if (isComite) {
      update.domicilio = document.getElementById("pDomicilio").value.trim();
    }
    const { error } = await supabaseClient.from("residentes").update(update).eq("id", p.id);
    const banner = document.getElementById("perfilBanner");
    if (error) {
      banner.innerHTML = `<div class="banner banner-error">No se pudo guardar: ${escapeHtml(error.message)}</div>`;
      return;
    }
    Object.assign(CURRENT_PROFILE, update);
    document.getElementById("userLabel").textContent =
      CURRENT_PROFILE.nombre_completo + " · " + (CURRENT_PROFILE.rol === "comite" ? "Comité" : "Residente");
    banner.innerHTML = '<div class="banner banner-ok">Cambios guardados.</div>';
  });
}

init();
