#!/usr/bin/env bash
#
# Respaldo cifrado de la base de datos · Guía FASE 6, checklist §4.11
#
# Genera un dump comprimido, lo cifra con AES-256 y rota los antiguos.
# La clave NUNCA va en el script: se toma de RESPALDO_CLAVE (variable de entorno
# del servidor, fuera del repo).
#
# Uso:
#   RESPALDO_CLAVE='...' ./scripts/respaldo.sh
#   RESPALDO_CLAVE='...' ./scripts/respaldo.sh --restaurar respaldos/provivir-2026-08-21.dump.gz.enc
#
# En cron (diario a las 2:00, con la clave en /etc/provivir/respaldo.env):
#   0 2 * * * . /etc/provivir/respaldo.env && /opt/provivir/apps/api/scripts/respaldo.sh >> /var/log/provivir-respaldo.log 2>&1

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_RESPALDOS="${DIR_RESPALDOS:-$RAIZ/respaldos}"
RETENCION_DIAS="${RETENCION_DIAS:-30}"

# Herramientas: en producción vienen del contenedor de Postgres o del paquete
# postgresql-client; PG_BIN permite apuntar a una instalación de usuario.
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_dump 2>/dev/null || echo /usr/bin/pg_dump)")}"
export LD_LIBRARY_PATH="${PG_LIB:-}${PG_LIB:+:}${LD_LIBRARY_PATH:-}"

if [ -z "${DATABASE_URL:-}" ]; then
  # shellcheck disable=SC1091
  [ -f "$RAIZ/.env" ] && set -a && . "$RAIZ/.env" && set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Falta DATABASE_URL" >&2
  exit 1
fi

# Prisma agrega parámetros propios a la URL (`schema`, `connection_limit`) que
# libpq no reconoce y hacen fallar a pg_dump. Se conservan solo los estándar.
limpiar_url() {
  local url="$1" base query conservados=""
  base="${url%%\?*}"
  query="${url#*\?}"
  [ "$query" = "$url" ] && { echo "$base"; return; }

  local IFS='&'
  for par in $query; do
    case "${par%%=*}" in
      sslmode|sslrootcert|sslcert|sslkey|connect_timeout|application_name)
        conservados="${conservados:+$conservados&}$par" ;;
    esac
  done
  [ -n "$conservados" ] && echo "$base?$conservados" || echo "$base"
}

URL_PG="$(limpiar_url "$DATABASE_URL")"

if [ -z "${RESPALDO_CLAVE:-}" ]; then
  echo "Falta RESPALDO_CLAVE. El respaldo trae datos de 400.000 pacientes: no se genera sin cifrar." >&2
  exit 1
fi

restaurar() {
  local archivo="$1"
  [ -f "$archivo" ] || { echo "No existe: $archivo" >&2; exit 1; }

  echo "Restaurando desde $archivo"
  # -d con --clean: reemplaza el contenido existente. Se restaura sobre la base
  # que indique DATABASE_URL, que en una prueba debe ser una base desechable.
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:RESPALDO_CLAVE -in "$archivo" \
    | gunzip \
    | "$PG_BIN/pg_restore" --dbname "$URL_PG" --clean --if-exists --no-owner --no-privileges

  echo "Restauración completa."
}

if [ "${1:-}" = "--restaurar" ]; then
  restaurar "${2:-}"
  exit 0
fi

mkdir -p "$DIR_RESPALDOS"
FECHA="$(date +%Y-%m-%d-%H%M)"
DESTINO="$DIR_RESPALDOS/provivir-$FECHA.dump.gz.enc"

echo "Generando respaldo $DESTINO"

# Un respaldo a medias es peor que ninguno: si algo falla, no queda el archivo roto.
trap 'rm -f "$DESTINO"' ERR

# El formato custom (-Fc) permite restauración selectiva y es más compacto que SQL plano.
"$PG_BIN/pg_dump" --dbname "$URL_PG" --format=custom --no-owner --no-privileges \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:RESPALDO_CLAVE -out "$DESTINO"

# Un respaldo vacío o truncado es peor que ninguno: se verifica que tenga cuerpo.
TAMANIO=$(stat -c%s "$DESTINO")
if [ "$TAMANIO" -lt 1024 ]; then
  echo "El respaldo generado pesa $TAMANIO bytes: se descarta por sospechoso." >&2
  rm -f "$DESTINO"
  exit 1
fi

echo "Respaldo completo: $(numfmt --to=iec "$TAMANIO" 2>/dev/null || echo "$TAMANIO bytes")"

# Rotación
find "$DIR_RESPALDOS" -name 'provivir-*.dump.gz.enc' -mtime "+$RETENCION_DIAS" -delete
echo "Respaldos conservados: $(find "$DIR_RESPALDOS" -name 'provivir-*.dump.gz.enc' | wc -l) (retención: $RETENCION_DIAS días)"
