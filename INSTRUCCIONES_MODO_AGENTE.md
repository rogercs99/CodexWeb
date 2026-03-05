# Instrucciones De Modo Agente En CodexWeb

## Integraciones disponibles

CodexWeb deja solo integraciones que puede ejecutar en modo agente real (con control de archivos/comandos):

- Codex CLI
- Gemini CLI

## Gemini CLI En Modo Agente

1. Instala Gemini CLI en el servidor donde corre CodexWeb:

```bash
npm install -g @google/gemini-cli
```

2. Si el binario no queda en PATH, configura en `.env`:

```bash
GEMINI_CMD=/ruta/completa/a/gemini
```

3. Para acceso total del sistema en modo root, configura también:

```bash
GEMINI_INCLUDE_DIRECTORIES=/
```

4. Crea una API key en Google AI Studio.
5. En la app: `Settings > Integraciones IA > Gemini CLI`.
6. Activa la integración, pega la API key y pulsa `Guardar`.
7. En `Settings > Agente en uso`, selecciona `Gemini CLI`.
8. Abre un chat nuevo y prueba una tarea de sistema.

Ejemplo de prueba:

```text
Lista los archivos del proyecto y crea un resumen de los 3 que veas más importantes.
```

## Codex CLI En Modo Agente

1. En `Settings > Integraciones IA > Codex CLI`, pulsa `Iniciar sesion con ChatGPT`.
2. Completa el flujo de verificación.
3. Selecciona `Codex CLI` en `Agente en uso`.

## Notas

- Gemini se ejecuta en modo agente con `--approval-mode yolo --sandbox=false`.
- CodexWeb le pasa `--include-directories` (por defecto `/`) para acceso completo al host.
- Si seleccionas Gemini y falla, revisa primero: instalación de `gemini`, `GEMINI_CMD`, `GEMINI_INCLUDE_DIRECTORIES`, API key válida.
