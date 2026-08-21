#!/usr/bin/env bash
#
# Instalación y despliegue en el servidor · Grupo Provivir
#
#   sudo ./despliegue/instalar.sh
#
# Idempotente: se puede volver a correr. No pisa secretos ya generados ni
# reinstala lo que ya esté.
#
# Qué hace:
#   1. Instala Docker si falta y añade al usuario al grupo docker
#   2. Crea /etc/provivir/.env con secretos fuertes generados aquí
#   3. Compila los tres frontends y los coloca donde Caddy los sirve
#   4. Levanta el stack y aplica las migraciones
#   5. Comprueba que responda

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_PROD="/etc/provivir/.env"
COMPOSE="$RAIZ/despliegue/docker-compose.prod.yml"
DOMINIO_POR_DEFECTO="provivir.exagos.co"

# Quién es el usuario real cuando esto corre con sudo.
USUARIO="${SUDO_USER:-$USER}"

paso() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
aviso(){ printf '  \033[33m!\033[0m %s\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo: sudo $0" >&2; exit 1; }

# ─────────────────── 1. Docker ───────────────────
paso "Docker"

if command -v docker >/dev/null 2>&1; then
  ok "ya instalado: $(docker --version)"
else
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
  ok "instalado: $(docker --version)"
fi

systemctl enable --now docker >/dev/null 2>&1 || true

if id -nG "$USUARIO" | grep -qw docker; then
  ok "$USUARIO ya pertenece al grupo docker"
else
  usermod -aG docker "$USUARIO"
  aviso "$USUARIO agregado al grupo docker — necesita reiniciar su sesión para usarlo sin sudo"
fi

# ─────────────────── 2. Secretos ───────────────────
paso "Configuración y secretos"

mkdir -p /etc/provivir
chmod 700 /etc/provivir

if [ -f "$ENV_PROD" ]; then
  ok "$ENV_PROD ya existe — se conserva (no se pisan los secretos)"
else
  # Se generan aquí y no se muestran: quedan solo en el archivo, con permisos 600.
  cat > "$ENV_PROD" <<ENV
# Configuración de producción · Grupo Provivir
# Generado por despliegue/instalar.sh. Permisos 600, fuera del repositorio.

NODE_ENV=production
PORT=3000

# ── Dominio ──
# Al migrar al definitivo, cambia estas tres y reinicia: docker compose up -d caddy api
DOMINIO=$DOMINIO_POR_DEFECTO
CORS_ORIGINS=https://$DOMINIO_POR_DEFECTO
PORTAL_URL=https://$DOMINIO_POR_DEFECTO/citas

# ── Base de datos y colas ──
POSTGRES_USER=provivir
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
POSTGRES_DB=provivir
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)

# ── Sesiones ──
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# ── Rate limiting ──
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=120
THROTTLE_LOGIN_LIMIT=5

# ── Sede y banderas ──
SEDE_ID=cdc-oriente
KIOSKO_ACTIVO=false

# ── Respaldos ──
RESPALDO_CLAVE=$(openssl rand -base64 32 | tr -d '\n')

# ══════════════════════════════════════════════════════════════
# PENDIENTES — completar antes de usar cada canal.
# La plataforma arranca sin ellos; cada canal avisa en el log.
# ══════════════════════════════════════════════════════════════

# WhatsApp · Meta Cloud API
META_APP_SECRET=
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_WEBHOOK_VERIFY_TOKEN=djvnksdfj489_

# IA conversacional y transcripción
IA_PROVEEDOR=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5

# Transcripción de notas de voz (misma clave que OPENAI_API_KEY)
STT_URL=https://api.openai.com/v1/audio/transcriptions
STT_API_KEY=
STT_MODELO=whisper-1

# CAPTCHA del portal público
TURNSTILE_SECRET=
ENV
  chmod 600 "$ENV_PROD"
  ok "$ENV_PROD creado con secretos generados"
  aviso "Faltan las claves de Meta y OpenAI: edítalas cuando las tengas"
fi

# El usuario que despliega debe poder leerlo para que compose lo pase al contenedor.
chown "$USUARIO":"$(id -gn "$USUARIO")" "$ENV_PROD"

# ─────────────────── 3. Frontends ───────────────────
paso "Compilando los frontends"

cd "$RAIZ"
COMO_USUARIO=(sudo -u "$USUARIO" env "PATH=/home/$USUARIO/.local/node/bin:$PATH")

"${COMO_USUARIO[@]}" npm ci --silent

# Solo los frontends: la API se compila DENTRO de la imagen de Docker, con su propio
# cliente de Prisma. Compilarla aquí solo duplicaría trabajo y puntos de fallo.
for app in backoffice portal tv; do
  "${COMO_USUARIO[@]}" npm run build -w "@provivir/$app" --silent
done

# Dominio único con rutas: el backoffice en la raíz, portal y TV en las subcarpetas
# que coinciden con el `base` con que se compilaron.
# Se VACÍA el directorio en vez de borrarlo: `rm -rf` crea un inodo nuevo y el
# bind mount de Caddy sigue apuntando al viejo, que queda huérfano y vacío.
# Síntoma: los archivos están en el host y Caddy responde 404.
mkdir -p despliegue/web
find despliegue/web -mindepth 1 -delete

cp -r apps/backoffice/dist/. despliegue/web/
cp -r apps/portal/dist      despliegue/web/citas
cp -r apps/tv/dist          despliegue/web/tv
chown -R "$USUARIO":"$(id -gn "$USUARIO")" despliegue/web
ok "backoffice en / · portal en /citas · pantallas en /tv"

# Caddy se recrea al final, para que su bind mount tome el contenido actual.
RECREAR_CADDY=1

# ─────────────────── 4. Puertos ───────────────────
paso "Puertos 80 y 443"

for p in 80 443; do
  if ss -ltn 2>/dev/null | grep -q ":$p "; then
    aviso "el puerto $p ya está ocupado — Caddy no podrá tomarlo"
    ss -ltnp 2>/dev/null | grep ":$p " | head -2
  else
    ok "puerto $p libre"
  fi
done

# Procesos de desarrollo que estorban o confunden.
pkill -f 'dist/main.js' 2>/dev/null && aviso "API de desarrollo detenida" || true

# ─────────────────── 5. Levantar ───────────────────
paso "Levantando el stack"

docker compose -f "$COMPOSE" --env-file "$ENV_PROD" up -d --build
ok "contenedores arriba"

echo "  esperando a que la base acepte conexiones…"
for _ in $(seq 1 60); do
  if docker compose -f "$COMPOSE" --env-file "$ENV_PROD" exec -T postgres pg_isready -U provivir >/dev/null 2>&1; then
    ok "base lista"; break
  fi
  sleep 2
done

paso "Migraciones"

# `run --rm` levanta un contenedor efímero con las mismas dependencias. Con `exec`
# había un círculo vicioso: la API no arranca sin el esquema, y el esquema se
# aplicaba dentro de la API. Resultado: reinicios en bucle.
docker compose -f "$COMPOSE" --env-file "$ENV_PROD" \
  run --rm --entrypoint sh api -c "cd apps/api && npx prisma migrate deploy"
ok "esquema al día"

# Ahora que el esquema existe, la API puede arrancar de verdad.
docker compose -f "$COMPOSE" --env-file "$ENV_PROD" up -d --force-recreate api
echo "  esperando a que la API responda…"
for _ in $(seq 1 45); do
  if docker compose -f "$COMPOSE" --env-file "$ENV_PROD" exec -T api \
       node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok "API respondiendo"; break
  fi
  sleep 2
done

# El seed crea usuarios con contraseña conocida: nunca en producción.
aviso "El seed NO se ejecuta en producción. Las credenciales reales se crean aparte."

if [ "${RECREAR_CADDY:-0}" = "1" ]; then
  docker compose -f "$COMPOSE" --env-file "$ENV_PROD" up -d --force-recreate caddy >/dev/null 2>&1
  ok "Caddy recreado con los frontends actuales"
fi

# ─────────────────── 6. Comprobar ───────────────────
paso "Comprobación"

DOMINIO="$(grep -E '^DOMINIO=' "$ENV_PROD" | cut -d= -f2)"
TOKEN="$(grep -E '^META_WEBHOOK_VERIFY_TOKEN=' "$ENV_PROD" | cut -d= -f2)"

echo "  esperando el certificado TLS de Let's Encrypt…"
for _ in $(seq 1 45); do
  curl -sS -o /dev/null --max-time 5 "https://$DOMINIO/api/health" 2>/dev/null && break
  sleep 2
done

printf '  %-42s %s\n' "https://$DOMINIO/api/health" \
  "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMINIO/api/health" 2>/dev/null || echo 'sin respuesta')"
printf '  %-42s %s\n' "handshake del webhook" \
  "$(curl -sS --max-time 10 "https://$DOMINIO/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$TOKEN&hub.challenge=99887" 2>/dev/null || echo 'sin respuesta')"

cat <<FIN

────────────────────────────────────────────────────────
  Si el handshake devolvió 99887, el webhook está listo.

  Regístralo en el panel de Meta:
    URL:   https://$DOMINIO/api/webhooks/whatsapp
    Token: $TOKEN
    Campo: messages

  Faltan las claves en $ENV_PROD (Meta, OpenAI, Turnstile).
  Tras editarlas:  docker compose -f $COMPOSE --env-file $ENV_PROD up -d api

  Registros:  docker compose -f $COMPOSE --env-file $ENV_PROD logs -f
────────────────────────────────────────────────────────
FIN
