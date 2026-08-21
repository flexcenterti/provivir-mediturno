#!/usr/bin/env bash
#
# Prueba del webhook de WhatsApp · simula lo que hace Meta.
#
# Ejercita las dos mitades del contrato:
#   1. El handshake GET de verificación (lo que Meta hace al registrar la URL).
#   2. La entrega POST firmada con HMAC-SHA256 (cada mensaje que llega después).
#
# Uso local:
#   ./scripts/probar-webhook.sh
#
# Contra el servidor desplegado:
#   BASE=https://provivir.exagos.co \
#   META_WEBHOOK_VERIFY_TOKEN=... META_APP_SECRET=... ./scripts/probar-webhook.sh
#
# Nota: contra el Meta real no hace falta firmar a mano — Meta firma. Este script
# sirve para verificar que el servidor acepta lo correcto y rechaza lo demás ANTES
# de registrar la URL en el panel.

set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
RUTA="$BASE/api/webhooks/whatsapp"
TELEFONO="${TELEFONO:-573001234567}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${META_APP_SECRET:-}" ] || [ -z "${META_WEBHOOK_VERIFY_TOKEN:-}" ]; then
  # shellcheck disable=SC1091
  [ -f "$RAIZ/.env" ] && set -a && . "$RAIZ/.env" && set +a
fi

: "${META_APP_SECRET:?Falta META_APP_SECRET}"
: "${META_WEBHOOK_VERIFY_TOKEN:?Falta META_WEBHOOK_VERIFY_TOKEN}"

ok=0
fallos=0

# Compara lo obtenido contra lo esperado y lleva la cuenta.
verificar() {
  local etiqueta="$1" esperado="$2" obtenido="$3"
  if [ "$obtenido" = "$esperado" ]; then
    printf '  \033[32m✓\033[0m %-52s %s\n' "$etiqueta" "$obtenido"
    ok=$((ok + 1))
  else
    printf '  \033[31m✗\033[0m %-52s esperaba %s, llegó %s\n' "$etiqueta" "$esperado" "$obtenido"
    fallos=$((fallos + 1))
  fi
}

# Firma el cuerpo igual que lo hace Meta.
firmar() {
  printf '%s' "$1" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //'
}

enviar() {
  local cuerpo="$1" firma="${2:-}"
  [ -z "$firma" ] && firma="sha256=$(firmar "$cuerpo")"
  curl -sS -o /dev/null -w '%{http_code}' -X POST "$RUTA" \
    -H 'Content-Type: application/json' \
    -H "x-hub-signature-256: $firma" \
    -d "$cuerpo"
}

# Envoltorio de webhook de Meta con un mensaje dentro.
mensaje() {
  local id="$1" tipo="$2" carga="$3"
  cat <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"WABA_ID","changes":[{"field":"messages","value":{
"messaging_product":"whatsapp",
"metadata":{"display_phone_number":"573150000001","phone_number_id":"PHONE_ID"},
"contacts":[{"profile":{"name":"Paciente de Prueba"},"wa_id":"$TELEFONO"}],
"messages":[{"id":"$id","from":"$TELEFONO","timestamp":"$(date +%s)","type":"$tipo",$carga}]
}}]}]}
JSON
}

echo
echo "Webhook: $RUTA"
echo

# ─────────────────── 1. Handshake de verificación (GET) ───────────────────
echo "1. Verificación de registro — lo que Meta hace al dar de alta la URL"

challenge="$RANDOM$RANDOM"
verificar "token correcto devuelve el challenge" "$challenge" \
  "$(curl -sS "$RUTA?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN&hub.challenge=$challenge")"

verificar "token incorrecto" "401" \
  "$(curl -sS -o /dev/null -w '%{http_code}' "$RUTA?hub.mode=subscribe&hub.verify_token=equivocado&hub.challenge=$challenge")"

verificar "sin token" "401" \
  "$(curl -sS -o /dev/null -w '%{http_code}' "$RUTA?hub.mode=subscribe&hub.challenge=$challenge")"

echo

# ─────────────────── 2. Firma de los mensajes (POST) ───────────────────
echo "2. Firma HMAC — sin esto cualquiera podría agendar citas en nombre de otros"

cuerpo="$(mensaje "wamid.firma.$RANDOM" text '"text":{"body":"hola"}')"

verificar "firma válida" "200" "$(enviar "$cuerpo")"
verificar "firma de otro secreto" "401" "$(enviar "$cuerpo" "sha256=$(printf '%s' "$cuerpo" | openssl dgst -sha256 -hmac 'secreto-equivocado' | sed 's/^.* //')")"
verificar "sin cabecera de firma" "401" "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$RUTA" -H 'Content-Type: application/json' -d "$cuerpo")"
verificar "cuerpo alterado tras firmar" "401" \
  "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$RUTA" -H 'Content-Type: application/json' \
     -H "x-hub-signature-256: sha256=$(firmar "$cuerpo")" -d "$(mensaje 'wamid.alterado' text '"text":{"body":"MENSAJE DISTINTO"}')")"
verificar "algoritmo distinto de sha256" "401" "$(enviar "$cuerpo" "sha1=$(firmar "$cuerpo")")"

echo

# ─────────────────── 3. Tipos de mensaje ───────────────────
echo "3. Multimedia entrante — cada tipo se acepta y se encola"

verificar "texto" "200" "$(enviar "$(mensaje "wamid.txt.$RANDOM" text '"text":{"body":"Quiero una cita"}')")"
verificar "nota de voz" "200" "$(enviar "$(mensaje "wamid.voz.$RANDOM" audio '"audio":{"id":"MEDIA_1","mime_type":"audio/ogg","voice":true}')")"
verificar "imagen (orden médica)" "200" "$(enviar "$(mensaje "wamid.img.$RANDOM" image '"image":{"id":"MEDIA_2","mime_type":"image/jpeg"}')")"
verificar "documento" "200" "$(enviar "$(mensaje "wamid.doc.$RANDOM" document '"document":{"id":"MEDIA_3","mime_type":"application/pdf","filename":"orden.pdf"}')")"
verificar "respuesta a botón" "200" "$(enviar "$(mensaje "wamid.btn.$RANDOM" interactive '"interactive":{"type":"button_reply","button_reply":{"id":"chat","title":"Seguir por aquí"}}')")"

echo
echo "4. Eventos que NO son mensajes — se aceptan y se ignoran"
verificar "acuse de entrega" "200" \
  "$(enviar '{"object":"whatsapp_business_account","entry":[{"id":"W","changes":[{"field":"messages","value":{"statuses":[{"id":"wamid.x","status":"delivered","timestamp":"1","recipient_id":"57300"}]}}]}]}')"
verificar "webhook vacío" "200" \
  "$(enviar '{"object":"whatsapp_business_account","entry":[]}')"

echo
echo "─────────────────────────────────────────────"
if [ "$fallos" -eq 0 ]; then
  printf '  \033[32m%d comprobaciones correctas\033[0m\n' "$ok"
  echo
  echo "  El webhook está listo para registrarse en Meta:"
  echo "    URL:    $RUTA"
  echo "    Token:  \$META_WEBHOOK_VERIFY_TOKEN"
  echo "    Campo:  messages"
else
  printf '  \033[31m%d fallo(s)\033[0m de %d comprobaciones\n' "$fallos" "$((ok + fallos))"
  exit 1
fi
echo
