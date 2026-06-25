# Steam Deck SSH setup (CodexWeb DEV)

Este flujo prepara la Steam Deck para usar la sección **Settings -> Steam Deck SSH** en `codexwebdev.gamemodai.pro`.

## 1) Activar contraseña del usuario `deck`
En la Steam Deck (modo escritorio):

```bash
passwd
```

Define una contraseña fuerte para `deck`.

## 2) Activar SSH en SteamOS
En la Steam Deck:

```bash
sudo systemctl enable --now sshd
sudo systemctl status sshd --no-pager
```

Debe quedar `active (running)`.

## 3) Añadir clave pública a `authorized_keys`
En CodexWeb DEV, abre `Settings -> Steam Deck SSH` y pulsa `Generate key`.
Copia la clave pública mostrada y en la Steam Deck ejecútalo:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
# Pega la clave pública en una línea nueva
echo 'ssh-ed25519 AAAA... codexweb-steamdeck-user_X' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## 4) Probar conexión desde el VPS
Desde el VPS donde corre CodexWeb:

```bash
ssh -i /root/CodexWeb/data/secrets/steamdeck_ssh_key deck@<HOST_DECK>
```

Ajusta `<HOST_DECK>` (IP LAN, hostname Tailscale, WireGuard, etc).

## 5) Configurar host/IP en CodexWeb DEV
En `Settings -> Steam Deck SSH` completa:
- `Host/IP`
- `Puerto SSH` (normalmente `22`)
- `Usuario SSH` (`deck`)
- `Ruta remota` (por defecto `/home/deck`)
- `Ruta Codex` (por defecto `codex`)

Guarda la configuración.

## 6) Probar `Test connection`
Pulsa `Test connection` y confirma estado OK.
Si falla con timeout/red: la Deck no está accesible o no está encendida.

## 7) Probar `Detect environment`
Pulsa `Detect environment` y revisa:
- hostname
- usuario
- SteamOS probable
- estado SSH
- estado de `codex`

## 8) Ejecutar comando simple
En panel `Command`, prueba por ejemplo:

```bash
uname -a
```

## 9) Validar Codex CLI remoto
En `Command` prueba:

```bash
which codex && codex --version
```

Si no existe, instala/configura Codex CLI en la Steam Deck y revisa `PATH`.

## 10) Lanzar una tarea Codex remota
En panel `Run Codex on Steam Deck`, escribe un prompt y lanza `Run Codex on Steam Deck`.
Revisa progreso y logs en `Jobs & History`.

## Nota de seguridad
- No abrir puerto 22 a internet si no es necesario.
- Prioriza Tailscale/WireGuard/LAN o túnel TCP/SSH privado.
- Mantén `allow dangerous commands` desactivado salvo necesidad explícita.
