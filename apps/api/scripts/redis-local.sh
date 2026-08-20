#!/usr/bin/env bash
# Redis local SIN Docker, para máquinas donde no hay demonio disponible.
# Donde SÍ haya Docker, el camino normal sigue siendo `docker compose up -d`.
set -euo pipefail

REDIS_BIN="${REDIS_BIN:-$HOME/.local/redis/bin/redis-server}"
DIR_DATOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.redisdata"
PUERTO="${REDIS_LOCAL_PORT:-6379}"

if [ ! -x "$REDIS_BIN" ]; then
  echo "No se encontró redis-server en $REDIS_BIN" >&2
  echo "Instalación sin root:" >&2
  echo "  curl -fsSL https://packages.redis.io/redis-stack/redis-stack-server-7.2.0-v11.jammy.x86_64.tar.gz \\" >&2
  echo "    | tar -xz -C \$HOME/.local --one-top-level=redis --strip-components=1" >&2
  exit 1
fi

mkdir -p "$DIR_DATOS"
exec "$REDIS_BIN" --port "$PUERTO" --dir "$DIR_DATOS" --appendonly yes
