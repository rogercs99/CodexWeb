# Claude config recovery

Fecha: 20260705-180043

## Problema
/home/claude-codexweb/.claude.json estaba corrupto:
JSON Parse error: Unexpected EOF.

## Fix aplicado
- Se pararon servicios relacionados con Claude/CodexWeb.
- Se guardó copia del config corrupto:
  /home/claude-codexweb/.claude.json.broken.20260705-180043
- Se buscó el backup JSON válido más reciente en:
  /home/claude-codexweb/.claude/backups
- Backup restaurado:
  /home/claude-codexweb/.claude/backups/.claude.json.backup.1783261491042
- Permisos aplicados:
  owner claude-codexweb:claude-codexweb
  chmod 600
- Validación:
  python3 -m json.tool "/home/claude-codexweb/.claude.json"

## Nota
Si vuelve a pasar, buscar escrituras no atómicas sobre .claude.json:
- redirecciones tipo > archivo
- writeFile directo
- procesos concurrentes
- falta de tmp + validate + rename
