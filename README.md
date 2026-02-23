# CodexWeb Mobile

Aplicación web **mobile-first** con:

- Registro/login de usuarios.
- Solicitud y guardado seguro de API keys en SQLite (cifradas con AES-256-GCM).
- Chat web que invoca al Codex instalado localmente en la máquina host.

## Requisitos

- Node.js 18+
- Codex CLI disponible en el host (por defecto comando `codex`).

## Instalación

```bash
npm install
cp .env.example .env
npm start
```

Abrir `http://localhost:3000`.

## Seguridad aplicada

- Contraseñas con hash `bcrypt`.
- Sesiones con cookie `httpOnly`.
- API keys cifradas antes de persistir en SQLite.
- `helmet` para cabeceras de seguridad.

## Flujo de uso

1. Regístrate o haz login.
2. Introduce `OPENAI_API_KEY` (y opcionalmente `ANTHROPIC_API_KEY`).
3. Usa el chat; el backend ejecuta `codex --prompt "..."` con tus keys inyectadas en entorno.

## Variables de entorno

- `PORT`: puerto HTTP.
- `SESSION_SECRET`: secreto de sesión.
- `ENCRYPTION_SECRET`: secreto para cifrar/descifrar keys.
- `CODEX_CMD`: comando del CLI de Codex (por defecto `codex`).
- `NODE_ENV`: `development` o `production`.
