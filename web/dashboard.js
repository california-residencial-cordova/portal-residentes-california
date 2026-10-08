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

  // Se conecta el botón de salir aquí, antes de cualquier "return",
  // para que funcione incluso si todavía no hay perfil.
  document.getElementById("logoutBtn").addEventListener("click", signOut);

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

  renderTabs();
  const firstTab = profile.rol === "comite" ? "padron" : "perfil";
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
    : [["perfil", "Mi perfil"]];

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

  if (tab === "padron") return renderPadron();
  if (tab === "visitas") return renderVisitasComite();
  if (tab === "perfil") return renderPerfil();
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
// Llama a la función del servidor (Edge Function) que crea o
// elimina logins de residentes. Solo el comité puede usarla; el
// propio servidor vuelve a checar el rol antes de hacer nada.
// ============================================================
async function callAdminUsers(payload) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const resp = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  let result;
  try {
    result = await resp.json();
  } catch (e) {
    result = { error: "Respuesta inesperada del servidor." };
  }
  if (!resp.ok) {
    throw new Error(result.error || "No se pudo completar la operación.");
  }
  return result;
}

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
        <td data-label="Acción">
          <button type="button" class="btn btn-danger" data-delete-residente="${r.id}" data-nombre="${escapeHtml(r.nombre_completo)}" style="padding:6px 12px; font-size:12px;" ${r.id === CURRENT_PROFILE.id ? "disabled" : ""}>Eliminar</button>
        </td>
      </tr>`
    )
    .join("");

  content.innerHTML = `
    <div class="card">
      <h2>Agregar residente</h2>
      <p class="hint">Crea el acceso (correo + contraseña temporal) y sus datos en un solo paso. Dale al residente su correo y contraseña para que entre y la cambie desde "Mi perfil".</p>
      <div id="altaBanner"></div>
      <form id="altaResidenteForm">
        <div class="form-row">
          <div>
            <label for="aEmail">Correo</label>
            <input type="email" id="aEmail" required>
          </div>
          <div>
            <label for="aPassword">Contraseña temporal</label>
            <input type="text" id="aPassword" required minlength="6">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label for="aNombre">Nombre completo</label>
            <input type="text" id="aNombre" required>
          </div>
          <div>
            <label for="aTelefono">Teléfono (opcional)</label>
            <input type="tel" id="aTelefono">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label for="aDomicilio">Domicilio</label>
            <input type="text" id="aDomicilio" required>
          </div>
          <div>
            <label for="aTipoOcupacion">Tipo de ocupación</label>
            <select id="aTipoOcupacion">
              <option value="propietario">Propietario</option>
              <option value="arrendatario">Arrendatario</option>
              <option value="posesion_irregular">Posesión irregular</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Crear residente</button>
      </form>
    </div>

    <div class="card">
      <h2>Padrón de residentes</h2>
      <p class="hint">La ocupación y el rol son visibles solo para el comité. Cambia el valor en la lista para actualizarlo al instante.</p>
      <div id="padronBanner"></div>
      <table>
        <thead>
          <tr><th>Nombre</th><th>Domicilio</th><th>Teléfono</th><th>Ocupación</th><th>Rol</th><th></th></tr>
        </thead>
        <tbody>${rows || ""}</tbody>
      </table>
      ${residentes.length === 0 ? '<div class="empty-state">Todavía no hay residentes registrados.</div>' : ""}
    </div>
  `;

  document.getElementById("altaResidenteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const banner = document.getElementById("altaBanner");
    banner.innerHTML = "";
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    try {
      await callAdminUsers({
        action: "create",
        email: document.getElementById("aEmail").value.trim(),
        password: document.getElementById("aPassword").value,
        nombre_completo: document.getElementById("aNombre").value.trim(),
        telefono: document.getElementById("aTelefono").value.trim() || null,
        domicilio: document.getElementById("aDomicilio").value.trim(),
        tipo_ocupacion: document.getElementById("aTipoOcupacion").value,
      });
      banner.innerHTML = '<div class="banner banner-ok">Residente creado. Ya puede iniciar sesión con el correo y la contraseña que pusiste.</div>';
      renderPadron();
    } catch (err) {
      banner.innerHTML = `<div class="banner banner-error">No se pudo crear: ${escapeHtml(err.message)}</div>`;
      submitBtn.disabled = false;
    }
  });

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

  content.querySelectorAll("[data-delete-residente]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-residente");
      const nombre = btn.getAttribute("data-nombre");
      if (!confirm(`¿Eliminar a "${nombre}"? Esto borra su acceso por completo y no se puede deshacer.`)) {
        return;
      }
      btn.disabled = true;
      const banner = document.getElementById("padronBanner");
      try {
        await callAdminUsers({ action: "delete", user_id: id });
        renderPadron();
      } catch (err) {
        banner.innerHTML = `<div class="banner banner-error">No se pudo eliminar: ${escapeHtml(err.message)}</div>`;
        btn.disabled = false;
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

  const datosCard = isComite
    ? `
    <div class="card">
      <h2>Mi perfil</h2>
      <div id="perfilBanner"></div>
      <form id="perfilForm">
        <label for="pNombre">Nombre completo</label>
        <input type="text" id="pNombre" value="${escapeHtml(p.nombre_completo)}" required>

        <label for="pTelefono">Teléfono</label>
        <input type="tel" id="pTelefono" value="${escapeHtml(p.telefono || "")}">

        <label for="pDomicilio">Domicilio</label>
        <input type="text" id="pDomicilio" value="${escapeHtml(p.domicilio)}">

        <button type="submit" class="btn btn-primary">Guardar cambios</button>
      </form>
      <p class="hint" style="margin-top:16px;">
        Tipo de ocupación: <span class="pill pill-${p.tipo_ocupacion}">${TIPO_OCUPACION_LABEL[p.tipo_ocupacion] || p.tipo_ocupacion}</span>
      </p>
    </div>`
    : `
    <div class="card">
      <h2>Mi perfil</h2>
      <p class="hint">Estos datos los administra el comité. Si hay un error o necesitas actualizarlos, pídeles que los corrijan desde el padrón.</p>
      <label>Nombre completo</label>
      <input type="text" value="${escapeHtml(p.nombre_completo)}" disabled>

      <label>Teléfono</label>
      <input type="tel" value="${escapeHtml(p.telefono || "—")}" disabled>

      <label>Domicilio</label>
      <input type="text" value="${escapeHtml(p.domicilio)}" disabled>

      <p class="hint" style="margin-top:4px;">
        Tipo de ocupación: <span class="pill pill-${p.tipo_ocupacion}">${TIPO_OCUPACION_LABEL[p.tipo_ocupacion] || p.tipo_ocupacion}</span>
      </p>
    </div>`;

  content.innerHTML = `
    ${datosCard}
    <div class="card">
      <h2>Cambiar contraseña</h2>
      <p class="hint">Si el comité te dio una contraseña temporal, cámbiala aquí por una que solo tú conozcas.</p>
      <div id="passwordBanner"></div>
      <form id="passwordForm">
        <label for="pwNueva">Nueva contraseña</label>
        <input type="password" id="pwNueva" required minlength="6" autocomplete="new-password">

        <label for="pwConfirma">Confirmar contraseña</label>
        <input type="password" id="pwConfirma" required minlength="6" autocomplete="new-password">

        <button type="submit" class="btn btn-primary">Actualizar contraseña</button>
      </form>
    </div>
  `;

  if (isComite) {
    document.getElementById("perfilForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const update = {
        nombre_completo: document.getElementById("pNombre").value.trim(),
        telefono: document.getElementById("pTelefono").value.trim() || null,
        domicilio: document.getElementById("pDomicilio").value.trim(),
      };
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

  document.getElementById("passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const banner = document.getElementById("passwordBanner");
    banner.innerHTML = "";
    const nueva = document.getElementById("pwNueva").value;
    const confirma = document.getElementById("pwConfirma").value;

    if (nueva !== confirma) {
      banner.innerHTML = '<div class="banner banner-error">Las contraseñas no coinciden.</div>';
      return;
    }
    if (nueva.length < 6) {
      banner.innerHTML = '<div class="banner banner-error">La contraseña debe tener al menos 6 caracteres.</div>';
      return;
    }

    const { error } = await supabaseClient.auth.updateUser({ password: nueva });
    if (error) {
      banner.innerHTML = `<div class="banner banner-error">No se pudo cambiar: ${escapeHtml(error.message)}</div>`;
      return;
    }
    banner.innerHTML = '<div class="banner banner-ok">Contraseña actualizada.</div>';
    document.getElementById("passwordForm").reset();
  });
}

init();
