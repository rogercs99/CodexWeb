# Instrucciones de despliegue en Windows

Este repo incluye:

- `CodexWeb` (backend, en la raiz)
- `stitch_frontend/` (frontend principal)

## 1) Requisitos

- Windows 10/11
- Node.js 18 o superior (recomendado: Node.js 20 LTS)
- npm (se instala junto con Node.js)
- Opcional: Git

Verifica en PowerShell:

```powershell
node -v
npm -v
```

## 2) Desplegar CodexWeb (proyecto principal)

Abre PowerShell en la carpeta extraida del zip:

```powershell
cd <RUTA_DEL_ZIP_EXTRAIDO>
```

Instala dependencias:

```powershell
npm install
```

Crea el archivo de entorno:

```powershell
Copy-Item .env.example .env
```

Edita `.env` y define como minimo:

- `SESSION_SECRET` con un valor largo y aleatorio
- `OPENAI_API_KEY` (si vas a usar OpenAI)
- `CODEX_CMD` (por defecto `codex`)
- `PORT` (por ejemplo `3050`)

Inicia la app:

```powershell
npm start
```

Abre en el navegador:

`http://127.0.0.1:3050` (o el puerto que configures en `.env`)

## 3) Ejecutar stitch_frontend (Vite)

```powershell
cd stitch_frontend
npm install
npm run dev
```

Abre:

`http://localhost:3000`

## 4) Problemas comunes

- Error de puerto en uso:
  - cambia `PORT` en `.env` o ejecuta Vite con otro puerto.
- Error `codex` no encontrado:
  - instala el CLI de Codex o define la ruta completa en `CODEX_CMD`.
- Error al instalar modulos nativos (`better-sqlite3`):
  - usa Node.js 20 LTS y vuelve a correr `npm install`.
