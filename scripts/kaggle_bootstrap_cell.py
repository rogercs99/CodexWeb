#!/usr/bin/env python3
"""
CodexWeb Kaggle Bootstrap Cell
Descarga, verifica, extrae y arranca CodexWeb en un Kaggle Kernel

Uso en Kaggle Notebook:
    !python kaggle_bootstrap_cell.py --vps-url https://codexwebdev.gamemodai.pro

Opciones:
    --vps-url       URL del VPS donde está el bundle (requerido)
    --ngrok-token   Token de ngrok para túnel público (opcional)
    --skip-verify   Salta verificación SHA256 (NO RECOMENDADO)
"""

import os
import sys
import subprocess
import hashlib
import json
import time
import argparse
from pathlib import Path

# Configuración de rutas Kaggle
KAGGLE_WORKING = Path('/kaggle/working')
APP_DIR = KAGGLE_WORKING / 'codexweb-app'
RUNTIME_DIR = KAGGLE_WORKING / 'codexweb-runtime'
WORKSPACE_DIR = KAGGLE_WORKING / 'workspace'
BUNDLE_PATH = KAGGLE_WORKING / 'codexweb-kaggle-bundle.tar.gz'
LOG_FILE = KAGGLE_WORKING / 'codexweb-bootstrap.log'

def log(msg):
    """Log con timestamp"""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{timestamp}] {msg}'
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def run_command(cmd, check=True, capture=False, timeout=300):
    """Ejecuta comando shell"""
    log(f'Running: {cmd}')
    try:
        if capture:
            result = subprocess.run(
                cmd,
                shell=True,
                check=check,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return result.stdout.strip()
        else:
            subprocess.run(
                cmd,
                shell=True,
                check=check,
                timeout=timeout
            )
            return None
    except subprocess.TimeoutExpired:
        log(f'ERROR: Command timed out after {timeout}s: {cmd}')
        raise
    except subprocess.CalledProcessError as e:
        log(f'ERROR: Command failed (exit {e.returncode}): {cmd}')
        if capture and e.stderr:
            log(f'STDERR: {e.stderr}')
        raise

def compute_sha256(filepath):
    """Calcula SHA256 de un archivo"""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            sha256.update(chunk)
    return sha256.hexdigest()

def download_bundle(vps_url):
    """Descarga bundle desde VPS"""
    log('=== Step 1: Download Bundle ===')

    # Descargar manifest primero
    manifest_url = f'{vps_url}/api/kaggle-bundle/manifest'
    log(f'Downloading manifest from {manifest_url}')

    manifest_json = run_command(
        f'curl -sf "{manifest_url}"',
        capture=True
    )

    manifest = json.loads(manifest_json)
    log(f'Manifest version: {manifest["version"]}')
    log(f'Bundle size: {manifest["bundle"]["size_human"]}')

    expected_sha256 = manifest['bundle']['sha256']
    log(f'Expected SHA256: {expected_sha256}')

    # Descargar bundle
    bundle_url = f'{vps_url}/api/kaggle-bundle/latest'
    log(f'Downloading bundle from {bundle_url}')

    run_command(
        f'curl -# -o "{BUNDLE_PATH}" "{bundle_url}"',
        timeout=600  # 10 minutos para descarga
    )

    actual_size = BUNDLE_PATH.stat().st_size
    log(f'Downloaded {actual_size} bytes')

    return manifest, expected_sha256

def verify_bundle(expected_sha256, skip_verify=False):
    """Verifica SHA256 del bundle"""
    log('=== Step 2: Verify Bundle ===')

    if skip_verify:
        log('WARNING: Skipping SHA256 verification (--skip-verify)')
        return True

    log('Computing SHA256 checksum...')
    actual_sha256 = compute_sha256(BUNDLE_PATH)

    log(f'Expected: {expected_sha256}')
    log(f'Actual:   {actual_sha256}')

    if actual_sha256 != expected_sha256:
        log('ERROR: SHA256 mismatch! Bundle may be corrupted or tampered.')
        raise ValueError('SHA256 verification failed')

    log('✓ SHA256 verified successfully')
    return True

def extract_bundle():
    """Extrae bundle a /kaggle/working"""
    log('=== Step 3: Extract Bundle ===')

    # Crear directorio de extracción
    KAGGLE_WORKING.mkdir(parents=True, exist_ok=True)

    log(f'Extracting to {KAGGLE_WORKING}')
    run_command(
        f'tar -xzf "{BUNDLE_PATH}" -C "{KAGGLE_WORKING}"',
        timeout=180
    )

    # Verificar extracción
    if not APP_DIR.exists():
        raise FileNotFoundError(f'App directory not found after extraction: {APP_DIR}')

    log(f'✓ Extracted to {APP_DIR}')

    # Crear directorios runtime y workspace
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

    log(f'✓ Created runtime dir: {RUNTIME_DIR}')
    log(f'✓ Created workspace dir: {WORKSPACE_DIR}')

def install_dependencies():
    """Instala dependencias npm"""
    log('=== Step 4: Install Dependencies ===')

    os.chdir(APP_DIR)

    # Verificar que package.json existe
    package_json = APP_DIR / 'package.json'
    if not package_json.exists():
        raise FileNotFoundError(f'package.json not found in {APP_DIR}')

    log('Running npm install...')
    run_command('npm install --production', timeout=600)

    log('✓ Dependencies installed')

def configure_environment():
    """Configura variables de entorno desde Kaggle Secrets"""
    log('=== Step 5: Configure Environment ===')

    env_file = APP_DIR / '.env'

    # Leer .env.kaggle template
    template_file = APP_DIR / '.env.kaggle'
    if not template_file.exists():
        log('WARNING: .env.kaggle template not found, creating minimal config')
        env_content = 'NODE_ENV=kaggle\nPORT=3000\nHOST=0.0.0.0\n'
    else:
        env_content = template_file.read_text()

    # Inyectar secrets de Kaggle si existen
    try:
        from kaggle_secrets import UserSecretsClient
        secrets = UserSecretsClient()

        # Intentar leer secrets
        for secret_name in ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'NGROK_AUTHTOKEN']:
            try:
                value = secrets.get_secret(secret_name)
                if value:
                    env_content += f'\n{secret_name}={value}'
                    log(f'✓ Loaded secret: {secret_name}')
            except:
                log(f'  Secret not found: {secret_name} (optional)')

    except ImportError:
        log('WARNING: kaggle_secrets not available, secrets not loaded')
    except Exception as e:
        log(f'WARNING: Error loading secrets: {e}')

    # Escribir .env final
    env_file.write_text(env_content)
    log(f'✓ Environment configured: {env_file}')

def start_server():
    """Arranca CodexWeb server en background"""
    log('=== Step 6: Start CodexWeb Server ===')

    os.chdir(APP_DIR)

    log('Starting server...')

    # Arrancar en background redirigiendo logs
    log_path = RUNTIME_DIR / 'server.log'
    cmd = f'nohup node server.js > "{log_path}" 2>&1 &'
    run_command(cmd, check=False)

    # Esperar a que arranque
    log('Waiting for server to start...')
    max_attempts = 30
    for i in range(max_attempts):
        time.sleep(2)
        try:
            result = run_command(
                'curl -sf http://localhost:3000/api/health',
                check=False,
                capture=True,
                timeout=5
            )
            if result and 'ok' in result:
                log('✓ Server is running!')
                break
        except:
            pass

        if i == max_attempts - 1:
            log('ERROR: Server did not start in time')
            log('Check logs at: ' + str(log_path))
            raise TimeoutError('Server start timeout')

    log(f'✓ Server started (logs: {log_path})')

def setup_tunnel(ngrok_token=None):
    """Configura túnel público (ngrok o pinggy)"""
    log('=== Step 7: Setup Public Tunnel ===')

    # Intentar ngrok primero si hay token
    if ngrok_token:
        log('Configuring ngrok tunnel...')
        try:
            # Instalar ngrok si no existe
            run_command('which ngrok || pip install pyngrok', check=False)

            # Configurar authtoken
            run_command(f'ngrok authtoken {ngrok_token}')

            # Arrancar túnel en background
            run_command('nohup ngrok http 3000 > /kaggle/working/ngrok.log 2>&1 &', check=False)

            time.sleep(3)

            # Obtener URL pública
            tunnels = run_command(
                'curl -sf http://localhost:4040/api/tunnels',
                capture=True,
                timeout=10
            )
            tunnels_data = json.loads(tunnels)
            public_url = tunnels_data['tunnels'][0]['public_url']

            log(f'✓ ngrok tunnel: {public_url}')
            return public_url

        except Exception as e:
            log(f'ngrok failed: {e}, falling back to pinggy')

    # Fallback a pinggy
    log('Setting up pinggy tunnel...')
    try:
        run_command('nohup ssh -o StrictHostKeyChecking=no -R0:localhost:3000 a.pinggy.io > /kaggle/working/pinggy.log 2>&1 &', check=False)

        time.sleep(5)

        # Leer URL de los logs
        pinggy_log = Path('/kaggle/working/pinggy.log').read_text()
        for line in pinggy_log.split('\n'):
            if 'https://' in line and 'pinggy.io' in line:
                # Extraer URL
                import re
                match = re.search(r'(https://[a-z0-9\-]+\.pinggy\.io)', line)
                if match:
                    public_url = match.group(1)
                    log(f'✓ pinggy tunnel: {public_url}')
                    return public_url

        log('WARNING: Could not extract pinggy URL from logs')
        return 'http://localhost:3000 (no tunnel)'

    except Exception as e:
        log(f'pinggy failed: {e}')
        return 'http://localhost:3000 (no tunnel)'

def print_summary(public_url, manifest):
    """Imprime resumen final"""
    log('\n' + '='*60)
    log('CodexWeb Bootstrap Complete!')
    log('='*60)
    log(f'Version:       {manifest["version"]}')
    log(f'Public URL:    {public_url}')
    log(f'Local URL:     http://localhost:3000')
    log(f'Workspace:     {WORKSPACE_DIR}')
    log(f'Runtime:       {RUNTIME_DIR}')
    log('='*60)
    log('\nEndpoints:')
    log('  /api/health')
    log('  /api/runtime/kaggle/status')
    log('  /api/runtime/claude/preflight')
    log('  /api/runtime/codex/preflight')
    log('\nLogs:')
    log(f'  Bootstrap: {LOG_FILE}')
    log(f'  Server:    {RUNTIME_DIR}/server.log')
    log('\n✓ Ready to use!')

def main():
    parser = argparse.ArgumentParser(description='CodexWeb Kaggle Bootstrap')
    parser.add_argument('--vps-url', required=True, help='VPS URL (e.g., https://codexwebdev.gamemodai.pro)')
    parser.add_argument('--ngrok-token', help='ngrok authtoken (optional)')
    parser.add_argument('--skip-verify', action='store_true', help='Skip SHA256 verification (NOT RECOMMENDED)')

    args = parser.parse_args()

    try:
        log('=== CodexWeb Kaggle Bootstrap ===')
        log(f'VPS URL: {args.vps_url}')
        log(f'Working dir: {KAGGLE_WORKING}')

        # Paso 1-2: Descarga y verificación
        manifest, expected_sha256 = download_bundle(args.vps_url)
        verify_bundle(expected_sha256, skip_verify=args.skip_verify)

        # Paso 3: Extracción
        extract_bundle()

        # Paso 4: Dependencias
        install_dependencies()

        # Paso 5: Configuración
        configure_environment()

        # Paso 6: Arrancar servidor
        start_server()

        # Paso 7: Túnel público
        public_url = setup_tunnel(ngrok_token=args.ngrok_token)

        # Resumen final
        print_summary(public_url, manifest)

        return 0

    except Exception as e:
        log(f'\n❌ ERROR: {e}')
        log('Bootstrap failed. Check logs at: ' + str(LOG_FILE))
        import traceback
        log(traceback.format_exc())
        return 1

if __name__ == '__main__':
    sys.exit(main())
