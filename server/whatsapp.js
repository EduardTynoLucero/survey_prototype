/* ---------------------------------------------------------------
   Canal de WhatsApp. Soporta tres formas y usa la primera disponible:

     1) API oficial de Meta (Cloud API) — NO instala nada, solo HTTPS.
        Se activa poniendo CLOUD_TOKEN y CLOUD_PHONE_ID en config.js
     2) @whiskeysockets/baileys — ligera, pero al instalarse clona
        libsignal desde GitHub y en Windows suele fallar
     3) whatsapp-web.js — usa un Chrome sin ventana, se instala sin git

   Si no hay ninguna, arranca en MODO SIMULADO: todo funciona igual y
   los mensajes quedan en la bitacora, pero no salen.
   --------------------------------------------------------------- */
const path = require("path");
const config = require("./config");
const db = require("./db");

function intentar(nombre) {
  try {
    return require(nombre);
  } catch (error) {
    return null;
  }
}

const usaCloud = Boolean(config.CLOUD_TOKEN && config.CLOUD_PHONE_ID);
const baileys = usaCloud ? null : intentar("@whiskeysockets/baileys") || intentar("baileys");
const wweb = usaCloud || baileys ? null : intentar("whatsapp-web.js");
const qrcode = intentar("qrcode");
const qrTerminal = intentar("qrcode-terminal");

const PROVEEDOR = usaCloud ? "API oficial de Meta" : baileys ? "baileys" : wweb ? "whatsapp-web.js" : "";

const estado = {
  disponible: Boolean(PROVEEDOR),
  proveedor: PROVEEDOR,
  necesitaQR: Boolean(baileys || wweb),
  simulado: !PROVEEDOR,
  conectado: false,
  conectando: false,
  numero: "",
  qrTexto: "",
  qrImagen: "",
  ultimoError: "",
  intentos: 0,
};

let socket = null; // baileys
let cliente = null; // whatsapp-web.js

/* ---------- utilidades ---------- */
const soloDigitos = (numero) => String(numero).replace(/\D/g, "");

async function publicarQR(qr) {
  estado.qrTexto = qr;
  if (qrcode) {
    try {
      estado.qrImagen = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
    } catch (error) {
      estado.qrImagen = "";
    }
  }
  if (qrTerminal) {
    console.log(`\n[whatsapp] Escanee este QR con el número +${config.NUMERO_ORIGEN}:\n`);
    qrTerminal.generate(qr, { small: true });
  } else {
    console.log(`\n[whatsapp] QR listo. Ábralo en http://localhost:${config.PUERTO}/privado/ → menú WhatsApp\n`);
  }
}

function marcarConectado(numero) {
  estado.conectado = true;
  estado.conectando = false;
  estado.qrTexto = "";
  estado.qrImagen = "";
  estado.intentos = 0;
  estado.numero = numero || "";
  console.log(`[whatsapp] Conectado como ${estado.numero || "(API)"} vía ${PROVEEDOR}`);
}

function silencioso() {
  const nada = () => {};
  const logger = { level: "silent", trace: nada, debug: nada, info: nada, warn: nada, error: nada, fatal: nada };
  logger.child = () => logger;
  return logger;
}

/* ---------- conexion ---------- */
async function conectar() {
  if (!PROVEEDOR) {
    console.log("\n[whatsapp] MODO SIMULADO — no hay canal de WhatsApp configurado.");
    console.log("[whatsapp] Opción sin instalar nada: ponga WA_TOKEN y WA_PHONE_ID (ver server/config.js)");
    console.log("[whatsapp] Opción con librería:      npm install  ó  npm install whatsapp-web.js\n");
    return;
  }
  if (estado.conectando || estado.conectado) return;
  estado.conectando = true;
  estado.ultimoError = "";

  try {
    if (usaCloud) await conectarCloud();
    else if (baileys) await conectarBaileys();
    else await conectarWweb();
  } catch (error) {
    estado.conectando = false;
    estado.ultimoError = error.message;
    console.error("[whatsapp] Error al conectar:", error.message);
  }
}

/* ---------- 1. API oficial de Meta ---------- */
async function conectarCloud() {
  const url = `${config.CLOUD_URL}/${config.CLOUD_PHONE_ID}?fields=display_phone_number,verified_name`;
  try {
    const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${config.CLOUD_TOKEN}` } });
    const datos = await respuesta.json();
    if (!respuesta.ok) {
      throw new Error((datos.error && datos.error.message) || `HTTP ${respuesta.status}`);
    }
    marcarConectado(soloDigitos(datos.display_phone_number || ""));
  } catch (error) {
    /* Aunque falle la consulta del numero, el envio puede funcionar:
       se marca conectado y el error real saldra al enviar. */
    estado.conectando = false;
    estado.ultimoError = `No se pudo verificar el número (${error.message}). Se intentará enviar de todos modos.`;
    marcarConectado("");
    console.log("[whatsapp] " + estado.ultimoError);
  }
}

/* ---------- 2. Baileys ---------- */
async function conectarBaileys() {
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = baileys;
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "auth"));

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (error) {
    version = undefined;
  }

  socket = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    logger: silencioso(),
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) await publicarQR(qr);

    if (connection === "open") {
      marcarConectado(socket.user && socket.user.id ? socket.user.id.split(":")[0] : "");
    }

    if (connection === "close") {
      estado.conectado = false;
      estado.conectando = false;
      const codigo =
        lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
          ? lastDisconnect.error.output.statusCode
          : 0;
      const cerroSesion = codigo === (baileys.DisconnectReason && baileys.DisconnectReason.loggedOut);
      estado.ultimoError = cerroSesion ? "Sesión cerrada, vuelva a escanear el QR." : "Conexión cerrada, reintentando…";
      console.log("[whatsapp] " + estado.ultimoError);
      if (!cerroSesion && estado.intentos < 10) {
        estado.intentos += 1;
        setTimeout(conectar, 4000);
      }
    }
  });
}

/* ---------- 3. whatsapp-web.js ---------- */
async function conectarWweb() {
  const { Client, LocalAuth } = wweb;

  cliente = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, "auth-wweb") }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // imprescindible dentro de Docker
        "--disable-gpu",
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined,
    },
  });

  cliente.on("qr", (qr) => publicarQR(qr));
  cliente.on("ready", () => {
    const info = cliente.info || {};
    marcarConectado(info.wid && info.wid.user ? info.wid.user : "");
  });
  cliente.on("auth_failure", (mensaje) => {
    estado.conectado = false;
    estado.conectando = false;
    estado.ultimoError = `Fallo de autenticación: ${mensaje}`;
  });
  cliente.on("disconnected", (motivo) => {
    estado.conectado = false;
    estado.conectando = false;
    estado.ultimoError = `Desconectado: ${motivo}`;
  });

  await cliente.initialize();
}

/* ---------- envio ---------- */
async function enviarCloud(destino, texto) {
  const respuesta = await fetch(`${config.CLOUD_URL}/${config.CLOUD_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.CLOUD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: destino,
      type: "text",
      text: { preview_url: true, body: texto },
    }),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const detalle = (datos.error && datos.error.message) || `HTTP ${respuesta.status}`;
    throw new Error(detalle);
  }
  return datos;
}

/**
 * Envia un mensaje. Siempre al numero de prueba de config.js.
 * Devuelve { ok, simulado, error }
 */
async function enviar(texto, referencia = {}) {
  const destino = soloDigitos(config.NUMERO_DESTINO);
  const registro = {
    destino,
    origen: estado.numero || config.NUMERO_ORIGEN,
    texto,
    tipo: referencia.tipo || "mensaje",
    surveyId: referencia.surveyId || "",
    instanceId: referencia.instanceId || "",
    doctor: referencia.doctor || "",
    canal: PROVEEDOR || "simulado",
    simulado: !estado.conectado,
    ok: false,
    error: "",
  };

  if (!estado.conectado) {
    registro.error = PROVEEDOR ? "Canal de WhatsApp no conectado" : "Sin canal de WhatsApp configurado";
    db.mensajes.registrar(registro);
    console.log(`[whatsapp][simulado] → +${destino}\n${texto}\n`);
    return { ok: false, simulado: true, error: registro.error };
  }

  try {
    if (usaCloud) {
      await enviarCloud(destino, texto);
    } else if (baileys && socket) {
      await socket.sendMessage(`${destino}@s.whatsapp.net`, { text: texto });
    } else if (cliente) {
      await cliente.sendMessage(`${destino}@c.us`, texto);
    } else {
      throw new Error("No hay conexión activa");
    }
    registro.ok = true;
    registro.simulado = false;
    db.mensajes.registrar(registro);
    console.log(`[whatsapp] enviado a +${destino}`);
    return { ok: true, simulado: false };
  } catch (error) {
    registro.error = error.message;
    db.mensajes.registrar(registro);
    console.error("[whatsapp] error al enviar:", error.message);
    return { ok: false, simulado: false, error: error.message };
  }
}

async function cerrarSesion() {
  try {
    if (socket) await socket.logout();
    if (cliente) await cliente.logout();
  } catch (error) {
    /* ignorar */
  }
  socket = null;
  cliente = null;
  if (!usaCloud) estado.conectado = false;
  estado.conectando = false;
}

module.exports = { conectar, enviar, cerrarSesion, estado, config };
