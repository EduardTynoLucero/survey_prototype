/* ---------------------------------------------------------------
   Configuracion del prototipo.
   Los numeros de prueba estan quemados aqui a proposito.
   --------------------------------------------------------------- */
const os = require("os");

const PUERTO = Number(process.env.PORT || 3000);

/* Busca la IP de la red local para que el enlace que se manda por
   WhatsApp se pueda abrir desde el telefono, no solo desde esta PC. */
function ipLocal() {
  const interfaces = os.networkInterfaces();
  for (const nombre of Object.keys(interfaces)) {
    for (const red of interfaces[nombre] || []) {
      if (red.family === "IPv4" && !red.internal && !red.address.startsWith("169.254.")) {
        return red.address;
      }
    }
  }
  return "localhost";
}

const IP = ipLocal();

module.exports = {
  PUERTO,
  IP,

  /* Todas las encuestas de prueba se envian a este numero */
  NUMERO_DESTINO: "50230769579", // +502 3076 9579

  /* Numero desde el que se espera enviar (el que escanea el QR) */
  NUMERO_ORIGEN: "50246398632", // +502 4639 8632

  /* -------------------------------------------------------------
     CANAL 3: API oficial de WhatsApp (Meta Cloud API)
     No requiere instalar NADA: son llamadas HTTPS que Node ya hace.

     Como obtener los datos (5 minutos, gratis):
       1. Entre a  https://developers.facebook.com/  y cree una app
          de tipo "Business".
       2. Agregue el producto "WhatsApp".
       3. Copie el "Token de acceso temporal" y el "Identificador
          del numero de telefono".
       4. En "Para", agregue y verifique el numero +502 3076 9579.

     Pegue los dos valores aqui abajo, o arranque asi:
       set WA_TOKEN=EAAG...
       set WA_PHONE_ID=123456789
       npm start
     ------------------------------------------------------------- */
  CLOUD_TOKEN: process.env.WA_TOKEN || "",
  CLOUD_PHONE_ID: process.env.WA_PHONE_ID || "",
  CLOUD_URL: process.env.WA_GRAPH_URL || "https://graph.facebook.com/v21.0",

  /* Base del enlace que viaja en el mensaje de WhatsApp.
     Si el telefono esta en la misma red Wi-Fi, la IP local funciona.
     Para abrirlo desde fuera use un tunel (ngrok, cloudflared) y
     arranque asi:  set BASE_URL=https://xxxx.ngrok.io  &&  npm start */
  BASE_URL: process.env.BASE_URL || `https://survey.digitallabsgt.com`,

  /* Cada cuanto revisa la agenda si toca generar o cerrar (segundos) */
  INTERVALO_AGENDA: 20,
};
