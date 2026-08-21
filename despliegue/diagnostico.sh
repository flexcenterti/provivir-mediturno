#!/usr/bin/env bash
#
# Diagnóstico del despliegue · pega la salida completa.
#
#   sudo ./despliegue/diagnostico.sh
#
# Solo lee: no cambia nada. Enmascara los secretos.

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$RAIZ/despliegue/docker-compose.prod.yml"
ENV_PROD="/etc/provivir/.env"
DC=(docker compose -f "$COMPOSE" --env-file "$ENV_PROD")

titulo() { printf '\n\033[1m═══ %s ═══\033[0m\n' "$1"; }

titulo "Estado de los contenedores"
"${DC[@]}" ps 2>&1 | head -12

titulo "API · últimas 60 líneas"
"${DC[@]}" logs api --tail 60 --no-color 2>&1 | tail -60

titulo "API · ¿reiniciando en bucle?"
docker inspect despliegue-api-1 \
  --format '  estado: {{.State.Status}}
  código de salida: {{.State.ExitCode}}
  reinicios: {{.RestartCount}}
  error: {{.State.Error}}
  OOM: {{.State.OOMKilled}}' 2>&1

titulo "Caddy · últimas 25 líneas"
"${DC[@]}" logs caddy --tail 25 --no-color 2>&1 | tail -25

titulo "Variables que ve la API (valores enmascarados)"
"${DC[@]}" exec -T api env 2>/dev/null \
  | grep -E '^(NODE_ENV|PORT|DATABASE_URL|REDIS_URL|JWT_SECRET|DOMINIO|CORS_ORIGINS|PORTAL_URL|SEDE_ID|IA_PROVEEDOR|META_|OPENAI_|STT_|THROTTLE_)' \
  | sed -E 's/(SECRET|KEY|PASSWORD|TOKEN|CLAVE)=(.{0,4}).*/\1=\2…(definida)/; s#(://[^:]+:)[^@]+@#\1***@#' \
  | sort \
  || echo "  no se pudo consultar: el contenedor no está corriendo"

titulo "Configuración en disco (sin valores)"
grep -oE '^[A-Z_]+=' "$ENV_PROD" 2>/dev/null | tr -d '=' | while read -r k; do
  v="$(grep -E "^$k=" "$ENV_PROD" | cut -d= -f2-)"
  [ -n "$v" ] && echo "  $k = definida" || echo "  $k = VACÍA"
done

titulo "Conectividad interna"
printf '  api → postgres: '; "${DC[@]}" exec -T api node -e "require('net').connect(5432,'postgres').on('connect',()=>{console.log('ok');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(1)})" 2>&1 | tail -1
printf '  api → redis:    '; "${DC[@]}" exec -T api node -e "require('net').connect(6379,'redis').on('connect',()=>{console.log('ok');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(1)})" 2>&1 | tail -1
printf '  caddy → api:    '; "${DC[@]}" exec -T caddy wget -q -O- -T 5 http://api:3000/api/health 2>&1 | tail -1

titulo "Desde fuera"
printf '  https://provivir.exagos.co/api/health → '
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 https://provivir.exagos.co/api/health 2>&1 | tail -1
