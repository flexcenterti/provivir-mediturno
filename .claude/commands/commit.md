---
description: Crea un commit convencional, sincroniza con el remoto y opcionalmente hace push
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git pull:*), Bash(git push:*)
---

## Git Status

!`git status`

## Changes

!`git diff HEAD`

## Current branch

!`git branch --show-current`

---

Sigue estos pasos en orden:

### Step 1 — Analizar cambios
Revisa el diff y el status de arriba. Determina:
- El **type** de conventional commit: feat, fix, refactor, docs, test, chore, style
- El **scope**: módulo o área afectada (ej: `supervisor`, `todo`, `worker`, `hooks`)
- Una **descripción** menor a 50 caracteres

### Step 2 — Commit
Agrega solo los archivos relevantes (nunca `git add -A` a ciegas — revisa qué se está agregando) y crea el commit con el formato:
`type(scope): description`

### Step 3 — Sincronizar con el remoto
Si la rama actual tiene upstream configurado, ejecuta `git pull --rebase` para sincronizar. Si hay conflictos, muéstralos claramente y resuélvelos antes de continuar. Si no hay upstream, omite este paso.

### Step 4 — Push
Pregunta al usuario: **"¿Quieres hacer push a origin?"**
- Sí → `git push origin <rama-actual>` (usa `-u` si no hay upstream)
- No → muestra un resumen de lo que se hizo commit y detente
