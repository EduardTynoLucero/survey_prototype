/* =====================================================================
   Sesión del módulo de encuestas.
   Es un login de prueba: reconoce a la persona contra el personal del
   laboratorio y guarda quién entró para repartirlo según su rol.
     admin       -> sistema completo (/privado/)
     supervisor  -> portal, con los resultados de su equipo
     colaborador -> portal, solo su bandeja
   ===================================================================== */
(() => {
  "use strict";

  const CLAVE = "dl_sesion";

  const DL_SESION = {
    /* Quién está dentro, o null si nadie */
    actual() {
      try {
        const bruto = localStorage.getItem(CLAVE);
        return bruto ? JSON.parse(bruto) : null;
      } catch (error) {
        return null;
      }
    },

    guardar(empleado) {
      try {
        localStorage.setItem(CLAVE, JSON.stringify(empleado));
      } catch (error) {
        /* si el navegador no guarda, la sesión dura lo que dure la pestaña */
      }
    },

    salir(raiz = "") {
      try {
        localStorage.removeItem(CLAVE);
      } catch (error) {
        /* nada que limpiar */
      }
      window.location.replace(`${raiz}index.html`);
    },

    /* Todos entran al mismo sistema; adentro cada rol ve lo suyo */
    destino(empleado, raiz = "") {
      return `${raiz}privado/index.html`;
    },

    esAdmin(empleado) {
      return Boolean(empleado && empleado.role === "admin");
    },

    /* Jefe de área: es quien tiene equipo, no quien administra el módulo */
    esJefe(empleado) {
      return Boolean(empleado && empleado.supervisor);
    },

    /* Protege una pantalla: si no hay sesión, o el rol no alcanza,
       devuelve a la pantalla de inicio de sesión. */
    exigir(rolesPermitidos, raiz = "") {
      const empleado = DL_SESION.actual();
      if (!empleado) {
        window.location.replace(`${raiz}index.html`);
        return null;
      }
      if (rolesPermitidos && !rolesPermitidos.includes(empleado.role)) {
        window.location.replace(DL_SESION.destino(empleado, raiz));
        return null;
      }
      return empleado;
    },

    iniciales(nombre) {
      return String(nombre || "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((parte) => parte[0])
        .join("");
    },
  };

  window.DL_SESION = DL_SESION;
})();
