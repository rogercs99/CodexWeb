const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');

const execFileAsync = util.promisify(execFile);

const CONFIG_PATH = path.join(__dirname, 'data', 'quetzal-relay.json');
const DEFAULT_CONFIG = Object.freeze({
  port: 57321,
  publicHost: 'quetzal.gamemodai.pro',
  localTargetHost: '127.0.0.1',
  localTargetPort: 57321,
  sshUser: 'root'
});
const SSHD_CONFIG_PATH = '/etc/ssh/sshd_config';
const SSHD_CONFIG_DIR = '/etc/ssh/sshd_config.d';
const SSHD_DROPIN_PATH = path.join(SSHD_CONFIG_DIR, '99-codexweb-quetzal-relay.conf');
const MAIN_CONFIG_MARKER_START = '# >>> CodexWeb Quetzal Relay >>>';
const MAIN_CONFIG_MARKER_END = '# <<< CodexWeb Quetzal Relay <<<';

function nowIso() {
  return new Date().toISOString();
}

function ensureConfigDir() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
}

function fileExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch (_error) {
    return false;
  }
}

function isValidPort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535;
}

function normalizePort(value, fallback) {
  if (isValidPort(value)) return Number(value);
  if (typeof fallback !== 'undefined' && isValidPort(fallback)) return Number(fallback);
  throw new Error('Puerto invalido. Usa un TCP port entre 1024 y 65535.');
}

function isValidIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isValidHostname(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source || source.length > 253) return false;
  const labels = source.split('.');
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function normalizeHost(value, fallback) {
  const source = String(value || '').trim();
  if (!source) {
    const nextFallback = String(fallback || '').trim();
    if (nextFallback) return normalizeHost(nextFallback, '');
    throw new Error('Host invalido.');
  }
  if (isValidIpv4(source) || isValidHostname(source)) {
    return source;
  }
  throw new Error(`Host invalido: ${source}`);
}

function normalizeSshUser(value, fallback = DEFAULT_CONFIG.sshUser) {
  const source = String(value || '').trim();
  const candidate = source || String(fallback || '').trim();
  if (/^[a-z_][a-z0-9_-]*[$]?$/i.test(candidate)) {
    return candidate;
  }
  throw new Error('Usuario SSH invalido.');
}

function normalizeConfig(rawValue = {}, fallback = DEFAULT_CONFIG) {
  return {
    port: normalizePort(rawValue.port, fallback.port),
    publicHost: normalizeHost(rawValue.publicHost, fallback.publicHost),
    localTargetHost: normalizeHost(rawValue.localTargetHost, fallback.localTargetHost),
    localTargetPort: normalizePort(rawValue.localTargetPort, fallback.localTargetPort),
    sshUser: normalizeSshUser(rawValue.sshUser, fallback.sshUser)
  };
}

function writeJsonAtomic(targetPath, value) {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function loadConfig() {
  ensureConfigDir();
  if (!fileExists(CONFIG_PATH)) {
    writeJsonAtomic(CONFIG_PATH, DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const normalized = normalizeConfig(raw, DEFAULT_CONFIG);
    writeJsonAtomic(CONFIG_PATH, normalized);
    return normalized;
  } catch (_error) {
    writeJsonAtomic(CONFIG_PATH, DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(rawValue) {
  ensureConfigDir();
  const nextConfig = normalizeConfig(rawValue, loadConfig());
  writeJsonAtomic(CONFIG_PATH, nextConfig);
  return nextConfig;
}

function compactOutput(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function findCommandPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fileExists(candidate)) return candidate;
  }
  return String(candidates && candidates[0] ? candidates[0] : '').trim();
}

const SYSTEMCTL_BIN = findCommandPath(['/usr/bin/systemctl', '/bin/systemctl', 'systemctl']);
const SSHD_BIN = findCommandPath(['/usr/sbin/sshd', '/sbin/sshd', 'sshd']);
const SS_BIN = findCommandPath(['/usr/bin/ss', '/bin/ss', 'ss']);
const LSOF_BIN = findCommandPath(['/usr/bin/lsof', '/bin/lsof', 'lsof']);
const UFW_BIN = findCommandPath(['/usr/sbin/ufw', '/sbin/ufw', 'ufw']);

async function runCommand(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: typeof options.timeout === 'number' ? options.timeout : 8000,
      maxBuffer: 4 * 1024 * 1024
    });
    return {
      ok: true,
      command,
      args,
      code: 0,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || '')
    };
  } catch (error) {
    return {
      ok: false,
      command,
      args,
      code: Number.isInteger(error && error.code) ? error.code : null,
      stdout: String((error && error.stdout) || ''),
      stderr: String((error && error.stderr) || error.message || '')
    };
  }
}

async function detectSshServiceName() {
  const candidates = ['ssh', 'sshd'];
  for (const name of candidates) {
    const probe = await runCommand(SYSTEMCTL_BIN, ['status', name, '--no-pager', '-n', '0']);
    if (probe.ok) return name;
  }
  return 'ssh';
}

function parseEffectiveSshd(stdout) {
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const result = {
    allowTcpForwarding: '',
    gatewayPorts: ''
  };
  for (const line of lines) {
    const [key, ...rest] = line.split(/\s+/);
    if (!key) continue;
    const value = rest.join(' ').trim();
    if (key === 'allowtcpforwarding') result.allowTcpForwarding = value;
    if (key === 'gatewayports') result.gatewayPorts = value;
  }
  return result;
}

function parsePortListeners(port, outputs) {
  const combined = [outputs.ss, outputs.lsof]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
  const lines = combined
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.includes(`:${port}`));
  const processes = Array.from(
    new Set(
      lines
        .map((line) => {
          const match = line.match(/users:\(\("([^"]+)"/) || line.match(/^([a-zA-Z0-9._-]+)\s+/);
          return match && match[1] ? match[1] : '';
        })
        .filter(Boolean)
    )
  );
  return {
    listening: lines.length > 0,
    activeTunnel: lines.some((line) => /sshd/i.test(line)),
    processes,
    lines
  };
}

function parseUfwStatus(rawStatus, port) {
  const text = String(rawStatus || '');
  const active = /^Status:\s+active/im.test(text);
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const portAllowed =
    new RegExp(`^${escapedPort}/tcp\\b.*ALLOW`, 'im').test(text) ||
    new RegExp(`\\b${escapedPort}/tcp\\b`, 'i').test(text);
  return {
    active,
    portAllowed
  };
}

function buildCommands(config) {
  const { port, localTargetHost, localTargetPort, sshUser, publicHost } = config;
  const prefix = 'ssh -N -o ServerAliveInterval=15 -o ServerAliveCountMax=3';
  const remotePart = `-R 0.0.0.0:${port}:${localTargetHost}:${localTargetPort}`;
  const mainCommand = `${prefix} ${remotePart} ${sshUser}@IP_O_HOST_DEL_VPS`;
  const alternativeCommand = `${prefix} -R 0.0.0.0:${port}:IP_LOCAL_DE_TU_DISPOSITIVO:${localTargetPort} ${sshUser}@IP_O_HOST_DEL_VPS`;
  const friendInstructions = [
    'Para jugar conmigo:',
    '',
    '1. Abre Pokémon Quetzal en tu emulador GBA.',
    '2. Entra en Link Remote → Wi-Fi Client.',
    `3. En Host pon: ${publicHost}`,
    `4. En Puerto pon: ${port}`,
    '5. Dentro del juego entra en: MPLAYER',
    '',
    'No tienes que instalar ZeroTier ni VPN.'
  ].join('\n');
  const myInstructions = [
    '1. Abre Pokémon Quetzal en My Boy!.',
    '2. Entra en Link Remote → Wi-Fi Server.',
    '3. Mira el puerto que usa el emulador.',
    `4. En CodexWeb, pon ese puerto si no es ${port}.`,
    '5. Copia el comando SSH.',
    '6. Ejecútalo en la máquina donde estás usando el emulador.',
    '7. Deja la terminal abierta mientras jugáis.',
    '8. Entra en MPLAYER dentro del juego.'
  ];
  const explanations = [
    `El primer ${port} es el puerto público del VPS.`,
    `${localTargetHost}:${localTargetPort} es donde debería escuchar My Boy! o tu emulador en tu máquina.`,
    'Si el emulador escucha en otra IP o puerto, cambia localTargetHost/localTargetPort.',
    'La terminal del túnel debe quedarse abierta mientras jugáis.',
    'Sustituye IP_O_HOST_DEL_VPS por la IP pública real o hostname SSH directo del VPS.'
  ];
  return {
    mainCommand,
    alternativeCommand,
    friendInstructions,
    myInstructions,
    explanations
  };
}

function buildManagedSshBlock() {
  return [
    '# CodexWeb Quetzal Relay',
    'AllowTcpForwarding yes',
    'GatewayPorts clientspecified',
    ''
  ].join('\n');
}

function upsertManagedBlockIntoMainConfig(currentContent) {
  const block = `${MAIN_CONFIG_MARKER_START}\nAllowTcpForwarding yes\nGatewayPorts clientspecified\n${MAIN_CONFIG_MARKER_END}\n`;
  const source = String(currentContent || '');
  const markerRegex = new RegExp(
    `${MAIN_CONFIG_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MAIN_CONFIG_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
    'm'
  );
  if (markerRegex.test(source)) {
    return source.replace(markerRegex, block);
  }
  const suffix = source.endsWith('\n') ? '' : '\n';
  return `${source}${suffix}\n${block}`;
}

async function collectRelayStatus() {
  const config = loadConfig();
  const [sshServiceName, sshdTResult, ssResult, lsofResult, ufwResult] = await Promise.all([
    detectSshServiceName(),
    runCommand(SSHD_BIN, ['-T']),
    runCommand(SS_BIN, ['-ltnp']),
    runCommand(LSOF_BIN, ['-nP', `-iTCP:${config.port}`, '-sTCP:LISTEN']),
    runCommand(UFW_BIN, ['status'])
  ]);
  const [serviceActiveResult, serviceEnabledResult, serviceStatusResult] = await Promise.all([
    runCommand(SYSTEMCTL_BIN, ['is-active', sshServiceName]),
    runCommand(SYSTEMCTL_BIN, ['is-enabled', sshServiceName]),
    runCommand(SYSTEMCTL_BIN, ['status', sshServiceName, '--no-pager', '-n', '20'], { timeout: 10000 })
  ]);

  const effectiveConfig = parseEffectiveSshd(sshdTResult.stdout);
  const listeners = parsePortListeners(config.port, {
    ss: ssResult.stdout,
    lsof: lsofResult.stdout
  });
  const ufw = parseUfwStatus(ufwResult.stdout, config.port);
  const serviceActive = String(serviceActiveResult.stdout || '').trim() === 'active';
  const serviceEnabled = /enabled/i.test(String(serviceEnabledResult.stdout || '').trim());
  const allowTcpForwardingOk = effectiveConfig.allowTcpForwarding === 'yes';
  const gatewayPortsOk = effectiveConfig.gatewayPorts === 'clientspecified';
  const vpsPrepared = serviceActive && allowTcpForwardingOk && gatewayPortsOk;

  return {
    ok: true,
    checkedAt: nowIso(),
    host: os.hostname(),
    config,
    commands: buildCommands(config),
    sshd: {
      serviceName: sshServiceName,
      active: serviceActive,
      enabled: serviceEnabled,
      allowTcpForwarding: effectiveConfig.allowTcpForwarding || 'unknown',
      gatewayPorts: effectiveConfig.gatewayPorts || 'unknown'
    },
    listening: {
      port: config.port,
      active: listeners.listening,
      tunnelActive: listeners.activeTunnel,
      processes: listeners.processes,
      lines: listeners.lines
    },
    firewall: {
      active: ufw.active,
      portAllowed: ufw.portAllowed
    },
    summary: {
      vpsPrepared,
      needsSshdPrepare: !vpsPrepared,
      allowTcpForwardingOk,
      gatewayPortsOk,
      portListening: listeners.listening,
      tunnelActive: listeners.activeTunnel,
      firewallCouldBlock: ufw.active && !ufw.portAllowed,
      firewallOpen: !ufw.active || ufw.portAllowed
    },
    humanStates: [
      vpsPrepared ? 'VPS preparado' : 'Falta preparar SSHD',
      !ufw.active || ufw.portAllowed ? 'Puerto abierto en firewall' : 'Firewall podría bloquear el puerto',
      listeners.activeTunnel ? 'Túnel activo' : 'Falta iniciar el túnel desde tu máquina',
      gatewayPortsOk ? 'GatewayPorts activo' : 'GatewayPorts no está activo',
      allowTcpForwardingOk ? 'AllowTcpForwarding activo' : 'AllowTcpForwarding no está activo'
    ],
    diagnostics: {
      sshdT: compactOutput(sshdTResult.stdout || sshdTResult.stderr),
      ss: compactOutput(ssResult.stdout || ssResult.stderr),
      lsof: compactOutput(lsofResult.stdout || lsofResult.stderr),
      ufw: compactOutput(ufwResult.stdout || ufwResult.stderr),
      serviceStatus: compactOutput(serviceStatusResult.stdout || serviceStatusResult.stderr)
    }
  };
}

async function getCommandsPayload() {
  const config = loadConfig();
  return {
    ok: true,
    config,
    commands: buildCommands(config)
  };
}

async function getDiagnosticsPayload() {
  const status = await collectRelayStatus();
  return {
    ok: true,
    checkedAt: status.checkedAt,
    diagnostics: status.diagnostics,
    summary: status.summary,
    humanStates: status.humanStates,
    listening: status.listening,
    firewall: status.firewall,
    sshd: status.sshd,
    config: status.config
  };
}

function restoreFileState(targetPath, previous) {
  if (!previous || !previous.existed) {
    if (fileExists(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    return;
  }
  fs.writeFileSync(targetPath, previous.content, 'utf8');
}

async function prepareRelay() {
  const config = loadConfig();
  const mainConfigBefore = fs.readFileSync(SSHD_CONFIG_PATH, 'utf8');
  const backupPath = `${SSHD_CONFIG_PATH}.bak.codexweb-quetzal-relay.${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`;
  fs.copyFileSync(SSHD_CONFIG_PATH, backupPath);

  const mainHasInclude = /^\s*Include\s+\/etc\/ssh\/sshd_config\.d\/\*\.conf\s*$/im.test(mainConfigBefore);
  const targetConfigPath = mainHasInclude ? SSHD_DROPIN_PATH : SSHD_CONFIG_PATH;
  const previousTarget = fileExists(targetConfigPath)
    ? { existed: true, content: fs.readFileSync(targetConfigPath, 'utf8') }
    : { existed: false, content: '' };

  try {
    if (mainHasInclude) {
      fs.mkdirSync(SSHD_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(targetConfigPath, buildManagedSshBlock(), 'utf8');
    } else {
      fs.writeFileSync(targetConfigPath, upsertManagedBlockIntoMainConfig(mainConfigBefore), 'utf8');
    }

    const validateResult = await runCommand(SSHD_BIN, ['-t'], { timeout: 10000 });
    if (!validateResult.ok) {
      restoreFileState(targetConfigPath, previousTarget);
      return {
        ok: false,
        backupPath,
        targetConfigPath,
        error: 'La validación de sshd falló. No se reinició el servicio.',
        validation: {
          stdout: compactOutput(validateResult.stdout),
          stderr: compactOutput(validateResult.stderr)
        }
      };
    }

    const sshServiceName = await detectSshServiceName();
    const restartResult = await runCommand(SYSTEMCTL_BIN, ['restart', sshServiceName], { timeout: 15000 });
    if (!restartResult.ok) {
      return {
        ok: false,
        backupPath,
        targetConfigPath,
        error: `sshd validó, pero no se pudo reiniciar ${sshServiceName}.`,
        restart: {
          stdout: compactOutput(restartResult.stdout),
          stderr: compactOutput(restartResult.stderr)
        }
      };
    }

    const ufwStatus = await runCommand(UFW_BIN, ['status']);
    const ufw = parseUfwStatus(ufwStatus.stdout, config.port);
    let ufwAllowResult = null;
    if (ufw.active && !ufw.portAllowed) {
      ufwAllowResult = await runCommand(UFW_BIN, ['allow', `${config.port}/tcp`], { timeout: 15000 });
      if (!ufwAllowResult.ok) {
        return {
          ok: false,
          backupPath,
          targetConfigPath,
          error: `sshd quedó preparado, pero no se pudo abrir ${config.port}/tcp en UFW.`,
          ufw: {
            stdout: compactOutput(ufwAllowResult.stdout),
            stderr: compactOutput(ufwAllowResult.stderr)
          }
        };
      }
    }

    const status = await collectRelayStatus();
    return {
      ok: true,
      backupPath,
      targetConfigPath,
      config,
      validation: { stdout: compactOutput(validateResult.stdout), stderr: compactOutput(validateResult.stderr) },
      restart: { serviceName: sshServiceName, stdout: compactOutput(restartResult.stdout), stderr: compactOutput(restartResult.stderr) },
      ufw: {
        active: ufw.active,
        changed: Boolean(ufwAllowResult && ufwAllowResult.ok),
        stdout: compactOutput((ufwAllowResult && ufwAllowResult.stdout) || ''),
        stderr: compactOutput((ufwAllowResult && ufwAllowResult.stderr) || '')
      },
      status
    };
  } catch (error) {
    restoreFileState(targetConfigPath, previousTarget);
    return {
      ok: false,
      backupPath,
      targetConfigPath,
      error: error && error.message ? error.message : 'No se pudo preparar el relay.'
    };
  }
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  buildCommands,
  collectRelayStatus,
  getCommandsPayload,
  getDiagnosticsPayload,
  loadConfig,
  prepareRelay,
  saveConfig
};
