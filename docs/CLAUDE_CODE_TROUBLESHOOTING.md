# Claude Code Troubleshooting

## Caso resuelto el 2026-06-23
- Síntoma: `claude` en el perfil real de `root` tardaba mucho o parecía colgado; con `HOME` limpio respondía rápido con `Not logged in`.
- Causa más probable: estado corrupto o degradado en `~/.claude` y/o `~/.claude.json` del usuario `root` tras reinstalar/reautenticar, no problema de red ni del binario.
- Señal útil: si `HOME=/tmp/claude-clean-home claude -p "Responde exactamente: OK"` responde rápido, el problema está en el perfil de usuario.

## Mitigación aplicada
- Rotar el perfil viejo a backup en vez de borrarlo:
  - `~/.claude.disabled-...`
  - `~/.claude.json.disabled-...`
- Recrear un perfil mínimo:
  - `~/.claude/settings.json`
  - `~/.claude.json`
- Usar el wrapper no-root `/usr/local/bin/claude-codexweb-max`:

```bash
runuser -u claude-codexweb -- bash -lc '
  cd /root/CodexWeb
  exec claude --permission-mode bypassPermissions "$@"
' bash "$@"
```

- En dev, fijar `CLAUDE_CODE_BIN=/usr/local/bin/claude-codexweb-max`.
- Mantener [/.claudeignore](/root/CodexWeb/.claudeignore) para excluir carpetas pesadas del repo cuando Claude trabaje desde `/root/CodexWeb`.

## Validación mínima
- Terminal:

```bash
timeout 120 /usr/local/bin/claude-codexweb-max -p "Responde exactamente: OK"
```

- Resultado sano sin login activo: devolver `Not logged in` en pocos segundos, no quedarse colgado.
- CodexWeb dev: comprobar `curl http://127.0.0.1:3060/api/health` y que `codexwebdev.service` siga activo.

## Login manual si quedó pendiente
- Obtener URL de login: `/usr/local/bin/claude-codexweb-max auth login`
- Si el flujo imprime una URL OAuth, abrirla y pegar solo el código de autorización cuando Claude lo pida.
- Si hace falta capturar la URL en shell:

```bash
/usr/local/bin/claude-codexweb-max auth login | tee /tmp/claude-login-output.txt
```
