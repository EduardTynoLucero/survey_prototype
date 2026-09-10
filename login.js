/* =====================================================================
   Pantalla de inicio de sesión (localhost:3000).
   Detecta al usuario por su correo y lo manda a donde le toca.
   ===================================================================== */
(() => {
  "use strict";

  const mount = document.getElementById("loginMount");
  const state = { personal: [], error: "", entrando: false };

  const esc = (texto) =>
    String(texto == null ? "" : texto).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const ETIQUETA_ROL = {
    admin: "Administración del módulo",
    supervisor: "Jefe de área",
    colaborador: "Colaborador",
  };

  function render() {
    const admins = state.personal.filter((p) => p.role === "admin");
    const jefes = state.personal.filter((p) => p.role === "supervisor");
    const resto = state.personal.filter((p) => p.role === "colaborador");

    mount.innerHTML = `
      <section class="login-card">
        <h1>Iniciar sesión</h1>
        <p>Módulo de encuestas de Digital Labs. Ingrese con su correo institucional.</p>

        ${state.error ? `<div class="login-error">${esc(state.error)}</div>` : ""}

        <label class="login-field">
          <span>Correo institucional</span>
          <input id="correo" type="email" placeholder="nombre@digitallabsgt.com" autocomplete="username">
        </label>

        <label class="login-field">
          <span>Contraseña</span>
          <input id="clave" type="password" placeholder="Cualquiera sirve en la prueba" autocomplete="current-password">
        </label>

        <button class="login-btn" type="button" data-act="entrar" ${state.entrando ? "disabled" : ""}>
          ${state.entrando ? "Entrando…" : "Entrar"}
        </button>

        <div class="login-help">
          <b>Es un login de prueba:</b> reconoce el correo contra el personal del laboratorio y no valida contraseña.
          Según el rol se abre el sistema completo o el portal del colaborador.

          <label class="login-field">
            <span>Elija a alguien para entrar rápido</span>
            <select id="atajo">
              <option value="">- Seleccione una persona -</option>
              ${grupo("Administración del módulo", admins)}
              ${grupo("Jefes de área", jefes)}
              ${grupo("Colaboradores", resto)}
            </select>
          </label>
        </div>
      </section>`;

    const campo = document.getElementById("correo");
    if (campo && !state.entrando) campo.focus();
  }

  function grupo(titulo, gente) {
    if (!gente.length) return "";
    return `
      <optgroup label="${esc(titulo)}">
        ${gente
          .map((p) => `<option value="${esc(p.email)}">${esc(p.name)} — ${esc(p.position)}</option>`)
          .join("")}
      </optgroup>`;
  }

  async function entrar(correo) {
    const valor = String(correo || "").trim();
    if (!valor) {
      state.error = "Escriba su correo o elíjalo de la lista.";
      render();
      return;
    }

    state.entrando = true;
    state.error = "";
    render();

    try {
      const empleado = await DL.api.portalLogin(valor);
      DL_SESION.guardar(empleado);
      window.location.replace(DL_SESION.destino(empleado));
    } catch (error) {
      state.entrando = false;
      state.error = error.message || "No pudimos validar ese correo.";
      render();
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-act="entrar"]')) {
      const atajo = document.getElementById("atajo");
      const escrito = document.getElementById("correo").value;
      entrar(escrito || (atajo ? atajo.value : ""));
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "atajo" && event.target.value) {
      document.getElementById("correo").value = event.target.value;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const boton = document.querySelector('[data-act="entrar"]');
      if (boton && !boton.disabled) boton.click();
    }
  });

  /* Si ya había sesión abierta, se entra directo */
  (async () => {
    const abierta = DL_SESION.actual();
    if (abierta) {
      window.location.replace(DL_SESION.destino(abierta));
      return;
    }
    try {
      state.personal = await DL.api.portalPersonal();
    } catch (error) {
      state.personal = [];
      state.error = "No se pudo contactar al servidor. Verifique que esté ejecutándose.";
    }
    render();
  })();
})();
