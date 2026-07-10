/**
 * Kaggle Service - MVP para integración con CodexWeb
 * Usa la CLI de Kaggle para enviar jobs y recuperar resultados
 */

const { execFile, spawn } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const execFileAsync = util.promisify(execFile);

const DEFAULT_KAGGLE_CONFIG_DIR = String(
  process.env.KAGGLE_CONFIG_DIR || path.join(os.homedir(), '.kaggle')
).trim() || path.join(os.homedir(), '.kaggle');

function readKaggleConfig() {
  const kaggleJsonPath = path.join(DEFAULT_KAGGLE_CONFIG_DIR, 'kaggle.json');
  try {
    if (!fs.existsSync(kaggleJsonPath)) return null;
    const raw = fs.readFileSync(kaggleJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function resolveKaggleUsername() {
  const fromEnv = String(process.env.KAGGLE_USERNAME || '').trim();
  if (fromEnv) return fromEnv;
  const config = readKaggleConfig();
  const fromConfig = String(config && config.username ? config.username : '').trim();
  return fromConfig;
}

const KAGGLE_USERNAME = resolveKaggleUsername();

function buildKaggleRef(kernelId) {
  const safeKernelId = String(kernelId || '').trim();
  if (!safeKernelId) return '';
  return KAGGLE_USERNAME ? `${KAGGLE_USERNAME}/${safeKernelId}` : safeKernelId;
}

function resolveKaggleCli() {
  const candidates = [
    process.env.KAGGLE_CLI_PATH,
    path.join(os.homedir(), '.local/bin/kaggle'),
    '/usr/local/bin/kaggle',
    '/usr/bin/kaggle',
    'kaggle'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate.includes(path.sep)) {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

const KAGGLE_CLI = resolveKaggleCli();
const ZIP_CLI = process.env.ZIP_CLI_PATH || 'zip';
const JOB_STATE_FILE = 'job-state.json';

function buildKaggleEnv() {
  return {
    ...process.env,
    KAGGLE_CONFIG_DIR: DEFAULT_KAGGLE_CONFIG_DIR
  };
}

function getKagglePreflightError() {
  if (KAGGLE_CLI.includes(path.sep) && !fs.existsSync(KAGGLE_CLI)) {
    return `Kaggle CLI not found at ${KAGGLE_CLI}. Set KAGGLE_CLI_PATH to a valid executable.`;
  }

  if (process.env.KAGGLE_KEY && KAGGLE_USERNAME) {
    return null;
  }

  const kaggleJsonPath = path.join(DEFAULT_KAGGLE_CONFIG_DIR, 'kaggle.json');
  if (!fs.existsSync(kaggleJsonPath)) {
    return `Kaggle credentials not found at ${kaggleJsonPath}. Set KAGGLE_CONFIG_DIR or provide KAGGLE_USERNAME/KAGGLE_KEY.`;
  }

  if (!KAGGLE_USERNAME) {
    return `Kaggle credentials found at ${kaggleJsonPath}, but username is missing. Set KAGGLE_USERNAME or ensure kaggle.json includes "username".`;
  }

  return null;
}

// Directorio temporal para kernels
const KERNELS_DIR = path.resolve(process.env.KAGGLE_KERNELS_DIR || path.join(__dirname, '.runtime', 'kaggle-kernels'));

// Asegurar que existe el directorio
if (!fs.existsSync(KERNELS_DIR)) {
  fs.mkdirSync(KERNELS_DIR, { recursive: true });
}

// Cache de jobs en memoria (en producción usar DB)
const jobsCache = new Map();

function getJobStatePath(jobIdOrDir) {
  const baseDir =
    typeof jobIdOrDir === 'string' && jobIdOrDir.includes(path.sep)
      ? jobIdOrDir
      : buildJobDir(jobIdOrDir);
  return path.join(baseDir, JOB_STATE_FILE);
}

function sanitizeJobState(rawJob) {
  if (!rawJob || typeof rawJob !== 'object') {
    return null;
  }

  const id = String(rawJob.id || rawJob.jobId || '').trim();
  if (!id || !/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    return null;
  }

  const createdAt = String(rawJob.createdAt || '').trim() || new Date().toISOString();
  const chatIdValue = rawJob.chatId == null ? null : Number(rawJob.chatId);

  return {
    id,
    kaggleRef: String(rawJob.kaggleRef || buildKaggleRef(id)).trim() || buildKaggleRef(id),
    status: String(rawJob.status || 'unknown').trim() || 'unknown',
    code: typeof rawJob.code === 'string' ? rawJob.code : undefined,
    options: rawJob.options && typeof rawJob.options === 'object' ? rawJob.options : {},
    chatId: Number.isFinite(chatIdValue) ? chatIdValue : null,
    createdAt,
    updatedAt: typeof rawJob.updatedAt === 'string' ? rawJob.updatedAt : undefined,
    finishedAt: typeof rawJob.finishedAt === 'string' ? rawJob.finishedAt : undefined,
    lastChecked: typeof rawJob.lastChecked === 'string' ? rawJob.lastChecked : undefined,
    error: typeof rawJob.error === 'string' ? rawJob.error : undefined,
    kernelDir: buildJobDir(id),
    pushOutput: typeof rawJob.pushOutput === 'string' ? rawJob.pushOutput : undefined
  };
}

function persistJobState(job) {
  const normalizedJob = sanitizeJobState(job);
  if (!normalizedJob) {
    return;
  }

  fs.mkdirSync(normalizedJob.kernelDir, { recursive: true });

  const payload = {
    id: normalizedJob.id,
    kaggleRef: normalizedJob.kaggleRef,
    status: normalizedJob.status,
    options: normalizedJob.options,
    chatId: normalizedJob.chatId,
    createdAt: normalizedJob.createdAt,
    updatedAt: normalizedJob.updatedAt,
    finishedAt: normalizedJob.finishedAt,
    lastChecked: normalizedJob.lastChecked,
    error: normalizedJob.error
  };

  fs.writeFileSync(getJobStatePath(normalizedJob.kernelDir), JSON.stringify(payload, null, 2), 'utf8');
}

function hydrateJobFromDisk(jobDirName) {
  let kernelDir = null;
  try {
    kernelDir = buildJobDir(jobDirName);
  } catch (error) {
    console.warn(`[Kaggle] Skipping unexpected kernel directory ${jobDirName}:`, error.message);
    return null;
  }
  if (!fs.existsSync(kernelDir)) {
    return null;
  }

  const statePath = getJobStatePath(kernelDir);
  if (fs.existsSync(statePath)) {
    try {
      const rawState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return sanitizeJobState(rawState);
    } catch (error) {
      console.warn(`[Kaggle] Could not parse job state for ${jobDirName}:`, error.message);
    }
  }

  const metadataPath = path.join(kernelDir, 'kernel-metadata.json');
  let kaggleRef = buildKaggleRef(jobDirName);
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (typeof metadata?.id === 'string' && metadata.id.trim()) {
        kaggleRef = metadata.id.trim();
      }
    } catch (error) {
      console.warn(`[Kaggle] Could not parse kernel metadata for ${jobDirName}:`, error.message);
    }
  }

  return sanitizeJobState({
    id: jobDirName,
    kaggleRef,
    status: fs.existsSync(buildJobOutputDir(jobDirName)) ? 'complete' : 'unknown',
    createdAt: fs.statSync(kernelDir).birthtime.toISOString()
  });
}

function restoreJobsCacheFromDisk() {
  if (!fs.existsSync(KERNELS_DIR)) {
    return;
  }

  const entries = fs.readdirSync(KERNELS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const restoredJob = hydrateJobFromDisk(entry.name);
    if (restoredJob) {
      jobsCache.set(restoredJob.id, restoredJob);
    }
  }
}

restoreJobsCacheFromDisk();

function assertValidJobId(jobId) {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId || !/^[a-z0-9][a-z0-9-]*$/i.test(normalizedJobId)) {
    throw new Error('Invalid jobId');
  }
  return normalizedJobId;
}

function buildJobDir(jobId) {
  return path.join(KERNELS_DIR, assertValidJobId(jobId));
}

function buildJobOutputDir(jobId) {
  return path.join(buildJobDir(jobId), 'output');
}

function assertValidOutputFileName(fileName) {
  const normalizedFileName = path.basename(String(fileName || '').trim());
  if (!normalizedFileName || normalizedFileName !== String(fileName || '').trim() || normalizedFileName === '.' || normalizedFileName === '..') {
    throw new Error('Invalid output file name');
  }
  return normalizedFileName;
}

/**
 * Generar un ID único para el kernel
 */
function generateKernelId() {
  return `codexweb-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Crear metadata del kernel para Kaggle
 */
function normalizeKaggleSourceList(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
  return [...new Set(list)]
    .filter((entry) => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(entry))
    .slice(0, 20);
}

function createKernelMetadata(kernelId, title, enableGpu = false, enableInternet = true, sources = {}) {
  // Kaggle resolves the slug from id/title. Hardware model is assigned by Kaggle;
  // CodexWeb can request GPU, then reports the actual model from nvidia-smi.
  return {
    id: buildKaggleRef(kernelId),
    title: String(title || kernelId).slice(0, 80),
    code_file: 'script.py',
    language: 'python',
    kernel_type: 'script',
    is_private: true,
    enable_gpu: enableGpu,
    enable_internet: enableInternet,
    dataset_sources: normalizeKaggleSourceList(sources.datasetSources),
    competition_sources: normalizeKaggleSourceList(sources.competitionSources),
    kernel_sources: normalizeKaggleSourceList(sources.kernelSources)
  };
}

/**
 * Enviar un job a Kaggle
 * @param {string} code - Código Python a ejecutar
 * @param {object} options - Opciones del job
 * @returns {Promise<object>} - Info del job creado
 */
async function submitJob(code, options = {}) {
  const preflightError = getKagglePreflightError();
  if (preflightError) {
    return {
      success: false,
      error: preflightError
    };
  }

  const kernelId = generateKernelId();
  const kernelDir = path.join(KERNELS_DIR, kernelId);

  // Crear directorio del kernel
  fs.mkdirSync(kernelDir, { recursive: true });

  // Escribir el código
  const scriptPath = path.join(kernelDir, 'script.py');
  fs.writeFileSync(scriptPath, code, 'utf8');

  // Crear metadata
  const metadata = createKernelMetadata(
    kernelId,
    options.title || `CodexWeb Job ${kernelId}`,
    options.enableGpu || false,
    options.enableInternet !== false,
    options
  );

  const metadataPath = path.join(kernelDir, 'kernel-metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  try {
    // Push del kernel a Kaggle
    const { stdout, stderr } = await execFileAsync(KAGGLE_CLI, ['kernels', 'push', '-p', kernelDir], {
      timeout: 60000,
      env: buildKaggleEnv()
    });

    const job = {
      id: kernelId,
      kaggleRef: buildKaggleRef(kernelId),
      status: 'queued',
      code,
      options,
      chatId: options.chatId || null,
      createdAt: new Date().toISOString(),
      kernelDir,
      pushOutput: stdout + stderr
    };

    jobsCache.set(kernelId, job);
    persistJobState(job);

    return {
      success: true,
      jobId: kernelId,
      kaggleRef: job.kaggleRef,
      chatId: job.chatId,
      message: 'Job enviado a Kaggle'
    };
  } catch (error) {
    // Limpiar directorio en caso de error
    fs.rmSync(kernelDir, { recursive: true, force: true });

    return {
      success: false,
      error: error.message,
      stderr: error.stderr
    };
  }
}

/**
 * Obtener el estado de un job
 * @param {string} jobId - ID del job
 * @returns {Promise<object>} - Estado del job
 */
async function getJobStatus(jobId) {
  const preflightError = getKagglePreflightError();
  if (preflightError) {
    return {
      success: false,
      jobId,
      error: preflightError
    };
  }

  const kaggleRef = buildKaggleRef(jobId);

  try {
    const { stdout } = await execFileAsync(KAGGLE_CLI, ['kernels', 'status', kaggleRef], {
      timeout: 30000,
      env: buildKaggleEnv()
    });

    // Parsear estado de la salida
    // Formato: '<username>/codexweb-abc123 has status "KernelWorkerStatus.COMPLETE"'
    let status = 'unknown';
    const statusMatch = stdout.match(/has status "(?:KernelWorkerStatus\.)?(\w+)"/i);
    if (statusMatch) {
      status = statusMatch[1].toLowerCase();
    }

    // Actualizar cache
    const cached = jobsCache.get(jobId);
    if (cached) {
      cached.status = status;
      cached.lastChecked = new Date().toISOString();
      cached.updatedAt = cached.lastChecked;
      cached.error = undefined;
      if (status === 'complete' || status === 'error' || status === 'cancelled') {
        cached.finishedAt = cached.lastChecked;
      }
      persistJobState(cached);
    }

    return {
      success: true,
      jobId,
      kaggleRef,
      status,
      raw: stdout.trim()
    };
  } catch (error) {
    const cached = jobsCache.get(jobId);
    if (cached) {
      cached.error = error.message;
      cached.updatedAt = new Date().toISOString();
      persistJobState(cached);
    }
    return {
      success: false,
      jobId,
      error: error.message,
      stderr: error.stderr
    };
  }
}

/**
 * Obtener el output/logs de un job
 * @param {string} jobId - ID del job
 * @returns {Promise<object>} - Output del job
 */
async function getJobOutput(jobId) {
  const preflightError = getKagglePreflightError();
  if (preflightError) {
    return {
      success: false,
      jobId,
      error: preflightError
    };
  }

  const normalizedJobId = assertValidJobId(jobId);
  const kaggleRef = buildKaggleRef(normalizedJobId);
  const outputDir = buildJobOutputDir(normalizedJobId);

  // Crear directorio de output si no existe
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Descargar output del kernel
    const { stdout, stderr } = await execFileAsync(KAGGLE_CLI, ['kernels', 'output', kaggleRef, '-p', outputDir], {
      timeout: 120000,
      env: buildKaggleEnv()
    });

    // Leer archivos descargados
    const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];
    const outputs = {};

    for (const file of files) {
      const filePath = path.join(outputDir, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && stat.size < 1024 * 1024) { // Limitar a 1MB
        if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
          outputs[file] = {
            type: 'image',
            base64: fs.readFileSync(filePath).toString('base64'),
            size: stat.size
          };
        } else {
          outputs[file] = {
            type: 'text',
            content: fs.readFileSync(filePath, 'utf8'),
            size: stat.size
          };
        }
      } else if (stat.isFile()) {
        outputs[file] = {
          type: 'large',
          size: stat.size,
        };
      }
    }

    // Parse .log file if present (Kaggle outputs JSON lines with stdout/stderr)
    let output = '';
    let stderr_output = '';
    const logFile = files.find(f => f.endsWith('.log'));
    if (logFile) {
      try {
        const logContent = fs.readFileSync(path.join(outputDir, logFile), 'utf8');
        const logEntries = JSON.parse(logContent);
        for (const entry of logEntries) {
          if (entry.stream_name === 'stdout') {
            output += entry.data;
          } else if (entry.stream_name === 'stderr') {
            stderr_output += entry.data;
          }
        }
      } catch (e) {
        // Log file might not be JSON, read as text
        output = fs.readFileSync(path.join(outputDir, logFile), 'utf8');
      }
    }

    const cached = jobsCache.get(normalizedJobId);
    if (cached) {
      cached.status = 'complete';
      cached.updatedAt = new Date().toISOString();
      cached.finishedAt = cached.finishedAt || cached.updatedAt;
      cached.error = undefined;
      persistJobState(cached);
    }

    return {
      success: true,
      jobId: normalizedJobId,
      kaggleRef,
      files: files,
      outputs,
      output: output.trim(),
      stderr: stderr_output.trim(),
      downloadLog: stdout + stderr
    };
  } catch (error) {
    const cached = jobsCache.get(normalizedJobId);
    if (cached) {
      cached.error = error.message;
      cached.updatedAt = new Date().toISOString();
      persistJobState(cached);
    }
    return {
      success: false,
      jobId: normalizedJobId,
      error: error.message,
      stderr: error.stderr
    };
  }
}

function resolveJobOutputFile(jobId, fileName) {
  const normalizedJobId = assertValidJobId(jobId);
  const normalizedFileName = assertValidOutputFileName(fileName);
  const outputDir = buildJobOutputDir(normalizedJobId);
  const filePath = path.join(outputDir, normalizedFileName);

  if (!fs.existsSync(filePath)) {
    throw new Error('Output file not found');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('Output file not found');
  }

  return {
    jobId: normalizedJobId,
    fileName: normalizedFileName,
    filePath,
    size: stat.size
  };
}

async function createJobOutputArchive(jobId) {
  const normalizedJobId = assertValidJobId(jobId);
  const outputDir = buildJobOutputDir(normalizedJobId);

  if (!fs.existsSync(outputDir)) {
    throw new Error('Output directory not found');
  }

  const files = fs.readdirSync(outputDir);
  if (!files.length) {
    throw new Error('No output files available');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexweb-kaggle-'));
  const archivePath = path.join(tempDir, `${normalizedJobId}-outputs.zip`);

  try {
    await execFileAsync(ZIP_CLI, ['-qr', archivePath, '.'], {
      cwd: outputDir,
      timeout: 120000
    });
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    jobId: normalizedJobId,
    archivePath,
    fileName: `${normalizedJobId}-outputs.zip`,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

/**
 * Listar jobs recientes del usuario
 * @param {number} limit - Número máximo de jobs a listar
 * @returns {Promise<object>} - Lista de jobs
 */
async function listJobs(limit = 20, options = {}) {
  const { chatId } = options;

  // Si se pide filtrar por chatId, usar solo el cache local
  if (chatId) {
    const cachedJobs = Array.from(jobsCache.values())
      .filter(job => job.chatId === chatId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(job => ({
        jobId: job.id,
        kaggleRef: job.kaggleRef,
        status: job.status,
        chatId: job.chatId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        finishedAt: job.finishedAt,
        error: job.error
      }));

    return {
      success: true,
      jobs: cachedJobs,
      total: cachedJobs.length
    };
  }

  const preflightError = getKagglePreflightError();
  if (preflightError) {
    return {
      success: false,
      error: preflightError
    };
  }

  try {
    // Obtener jobs del cache local con chatId para mantener la relación
    const cachedJobsMap = new Map();
    for (const [id, job] of jobsCache) {
      cachedJobsMap.set(job.kaggleRef, job);
    }

    const { stdout } = await execFileAsync(KAGGLE_CLI, ['kernels', 'list', '--mine', '--page-size', String(limit)], {
      timeout: 30000,
      env: buildKaggleEnv()
    });

    // Parsear la tabla de salida
    const lines = stdout.trim().split('\n');
    const jobs = [];

    // Saltar las primeras 2 líneas (headers)
    for (let i = 2; i < lines.length; i++) {
      const parts = lines[i].split(/\s{2,}/);
      if (parts.length >= 4) {
        const ref = parts[0];
        const cachedJob = cachedJobsMap.get(ref);
        jobs.push({
          jobId: cachedJob?.id || ref.split('/').pop(),
          kaggleRef: ref,
          title: parts[1],
          author: parts[2],
          lastRunTime: parts[3],
          votes: parts[4] || '0',
          chatId: cachedJob?.chatId || null,
          createdAt: cachedJob?.createdAt || null,
          updatedAt: cachedJob?.updatedAt || null,
          finishedAt: cachedJob?.finishedAt || null,
          status: cachedJob?.status || 'unknown',
          error: cachedJob?.error || null
        });
      }
    }

    return {
      success: true,
      jobs,
      total: jobs.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr
    };
  }
}

/**
 * Obtener job del cache local
 */
function getCachedJob(jobId) {
  return jobsCache.get(jobId) || null;
}

/**
 * Limpiar archivos temporales de un job
 */
function cleanupJob(jobId) {
  const kernelDir = path.join(KERNELS_DIR, jobId);
  if (fs.existsSync(kernelDir)) {
    fs.rmSync(kernelDir, { recursive: true, force: true });
  }
  jobsCache.delete(jobId);
}

/**
 * Eliminar todos los jobs y sus archivos
 */
function cleanupAllJobs() {
  const count = jobsCache.size;

  // Limpiar todos los directorios de kernels
  if (fs.existsSync(KERNELS_DIR)) {
    const entries = fs.readdirSync(KERNELS_DIR);
    for (const entry of entries) {
      const entryPath = path.join(KERNELS_DIR, entry);
      fs.rmSync(entryPath, { recursive: true, force: true });
    }
  }

  // Limpiar cache
  jobsCache.clear();

  return { deletedCount: count };
}

/**
 * Obtener detalles completos de un job (código, logs, etc)
 */
function getJobDetails(jobId) {
  const normalizedJobId = assertValidJobId(jobId);
  const cached = jobsCache.get(normalizedJobId);
  const kernelDir = buildJobDir(normalizedJobId);
  const outputDir = buildJobOutputDir(normalizedJobId);

  let code = cached?.code || null;
  let logs = null;
  let files = [];

  // Intentar leer el código del archivo si no está en cache
  if (!code) {
    const scriptPath = path.join(kernelDir, 'script.py');
    if (fs.existsSync(scriptPath)) {
      code = fs.readFileSync(scriptPath, 'utf8');
    }
  }

  // Leer logs del directorio de output
  if (fs.existsSync(outputDir)) {
    const outputFiles = fs.readdirSync(outputDir);
    const logFile = outputFiles.find(f => f.endsWith('.log'));

    if (logFile) {
      try {
        const logContent = fs.readFileSync(path.join(outputDir, logFile), 'utf8');
        // Intentar parsear como JSON (formato Kaggle)
        try {
          const logEntries = JSON.parse(logContent);
          let stdout = '';
          let stderr = '';
          for (const entry of logEntries) {
            if (entry.stream_name === 'stdout') {
              stdout += entry.data;
            } else if (entry.stream_name === 'stderr') {
              stderr += entry.data;
            }
          }
          logs = { stdout: stdout.trim(), stderr: stderr.trim(), raw: logContent };
        } catch {
          logs = { raw: logContent };
        }
      } catch (e) {
        // Ignorar errores de lectura
      }
    }

    // Listar archivos de output
    files = outputFiles.map(f => {
      const filePath = path.join(outputDir, f);
      const stat = fs.statSync(filePath);
      return {
        name: f,
        size: stat.size,
        isLog: f.endsWith('.log')
      };
    });
  }

  return {
    success: true,
    jobId: normalizedJobId,
    kaggleRef: cached?.kaggleRef || buildKaggleRef(normalizedJobId),
    code,
    logs,
    files,
    status: cached?.status || 'unknown',
    chatId: cached?.chatId || null,
    createdAt: cached?.createdAt || null,
    updatedAt: cached?.updatedAt || null,
    finishedAt: cached?.finishedAt || null,
    error: cached?.error || null
  };
}

// ============================================================================
// AUTO-RETRY SYSTEM - Loop de corrección con agente
// ============================================================================

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_TIME_MS = 10 * 60 * 1000; // 10 minutos máximo

/**
 * Ejecutar job con auto-retry
 * @param {string} code - Código Python inicial
 * @param {object} options - Opciones del job
 * @param {function} agentCallback - Función async que recibe (code, error) y devuelve código corregido
 * @param {function} statusCallback - Función opcional para reportar progreso
 * @returns {Promise<object>} - Resultado final
 */
async function submitWithAutoRetry(code, options = {}, agentCallback, statusCallback = () => {}) {
  const maxRetries = options.maxRetries || MAX_RETRIES;
  const history = [];
  let currentCode = code;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt++;
    statusCallback({ type: 'submit', attempt, maxRetries: maxRetries + 1, code: currentCode });

    // Enviar el código
    const submitResult = await submitJob(currentCode, {
      ...options,
      title: `${options.title || 'AutoRetry'} (attempt ${attempt})`
    });

    if (!submitResult.success) {
      history.push({
        attempt,
        phase: 'submit',
        error: submitResult.error,
        code: currentCode
      });

      // Error de submit, intentar corregir si hay callback
      if (agentCallback && attempt <= maxRetries) {
        statusCallback({ type: 'fixing', attempt, error: submitResult.error, phase: 'submit' });
        try {
          currentCode = await agentCallback(currentCode, {
            phase: 'submit',
            error: submitResult.error,
            stderr: submitResult.stderr
          });
          continue;
        } catch (agentError) {
          return {
            success: false,
            finalAttempt: attempt,
            error: `Agent failed to fix submit error: ${agentError.message}`,
            history
          };
        }
      }

      return {
        success: false,
        finalAttempt: attempt,
        error: submitResult.error,
        history
      };
    }

    const jobId = submitResult.jobId;
    statusCallback({ type: 'polling', attempt, jobId });

    // Polling hasta completar o error
    const pollResult = await pollUntilComplete(jobId, statusCallback);

    if (pollResult.status === 'complete') {
      // Obtener output
      const outputResult = await getJobOutput(jobId);

      // Verificar si hay errores en la ejecución
      const executionError = detectExecutionError(outputResult);

      if (!executionError) {
        // Éxito
        history.push({
          attempt,
          phase: 'complete',
          jobId,
          output: outputResult.output,
          files: outputResult.files
        });

        return {
          success: true,
          finalAttempt: attempt,
          jobId,
          output: outputResult.output,
          stderr: outputResult.stderr,
          files: outputResult.files,
          outputs: outputResult.outputs,
          history
        };
      }

      // Hay error de ejecución
      history.push({
        attempt,
        phase: 'execution_error',
        jobId,
        error: executionError,
        code: currentCode,
        output: outputResult.output,
        stderr: outputResult.stderr
      });

      // Intentar corregir si quedan reintentos
      if (agentCallback && attempt <= maxRetries) {
        statusCallback({ type: 'fixing', attempt, error: executionError, phase: 'execution' });
        try {
          currentCode = await agentCallback(currentCode, {
            phase: 'execution',
            error: executionError,
            output: outputResult.output,
            stderr: outputResult.stderr
          });
          continue;
        } catch (agentError) {
          return {
            success: false,
            finalAttempt: attempt,
            error: `Agent failed to fix: ${agentError.message}`,
            lastExecutionError: executionError,
            history
          };
        }
      }

      return {
        success: false,
        finalAttempt: attempt,
        error: executionError,
        history
      };
    }

    // Error de polling (timeout, cancelado, etc)
    history.push({
      attempt,
      phase: 'poll_error',
      jobId,
      status: pollResult.status,
      error: pollResult.error
    });

    if (pollResult.status === 'error' && agentCallback && attempt <= maxRetries) {
      // Intentar corregir errores de compilación/cancelación
      const outputResult = await getJobOutput(jobId);
      const executionError = outputResult.stderr || pollResult.error || 'Unknown error';

      statusCallback({ type: 'fixing', attempt, error: executionError, phase: 'runtime' });
      try {
        currentCode = await agentCallback(currentCode, {
          phase: 'runtime',
          error: executionError,
          output: outputResult.output,
          stderr: outputResult.stderr
        });
        continue;
      } catch (agentError) {
        return {
          success: false,
          finalAttempt: attempt,
          error: `Agent failed to fix runtime error: ${agentError.message}`,
          history
        };
      }
    }

    return {
      success: false,
      finalAttempt: attempt,
      error: pollResult.error || `Job ended with status: ${pollResult.status}`,
      history
    };
  }

  return {
    success: false,
    finalAttempt: attempt,
    error: 'Max retries exceeded',
    history
  };
}

/**
 * Poll hasta que el job complete o falle
 */
async function pollUntilComplete(jobId, statusCallback = () => {}) {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const statusResult = await getJobStatus(jobId);

    if (!statusResult.success) {
      return { status: 'error', error: statusResult.error };
    }

    statusCallback({ type: 'status', jobId, status: statusResult.status });

    switch (statusResult.status) {
      case 'complete':
        return { status: 'complete' };
      case 'error':
      case 'cancelrequested':
      case 'cancelacknowledged':
        return { status: 'error', error: `Kernel failed with status: ${statusResult.status}` };
      case 'queued':
      case 'running':
        // Seguir esperando
        await sleep(POLL_INTERVAL_MS);
        break;
      default:
        // Estado desconocido, seguir esperando
        await sleep(POLL_INTERVAL_MS);
    }
  }

  return { status: 'timeout', error: 'Polling timeout exceeded' };
}

/**
 * Detectar errores en el output de ejecución
 */
function detectExecutionError(outputResult) {
  if (!outputResult.success) {
    return outputResult.error;
  }

  const stderr = outputResult.stderr || '';
  const stdout = outputResult.output || '';

  // Detectar tracebacks de Python
  if (stderr.includes('Traceback (most recent call last)')) {
    // Extraer el error final
    const lines = stderr.split('\n');
    const errorLines = [];
    let capturing = false;

    for (const line of lines) {
      if (line.includes('Traceback')) {
        capturing = true;
        errorLines.length = 0;
      }
      if (capturing) {
        errorLines.push(line);
      }
    }

    return errorLines.join('\n') || stderr;
  }

  // Otros patrones de error comunes
  const errorPatterns = [
    /^Error:/im,
    /^Exception:/im,
    /ModuleNotFoundError:/,
    /ImportError:/,
    /SyntaxError:/,
    /NameError:/,
    /TypeError:/,
    /ValueError:/,
    /KeyError:/,
    /IndexError:/,
    /AttributeError:/,
    /FileNotFoundError:/,
    /PermissionError:/,
    /RuntimeError:/,
    /MemoryError:/
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(stderr) || pattern.test(stdout)) {
      return stderr || stdout;
    }
  }

  return null; // No error detected
}

/**
 * Helper para dormir
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Crear callback de agente usando Claude Code
 * Esta función se puede usar desde server.js para integrar con el agente
 */
function createClaudeAgentCallback(spawnClaudeCode) {
  return async (code, errorInfo) => {
    const prompt = buildCorrectionPrompt(code, errorInfo);

    // Ejecutar Claude Code con el prompt de corrección
    const result = await spawnClaudeCode(prompt, {
      systemPrompt: 'You are a Python code fixer. Fix the code and output ONLY the corrected code, nothing else. No explanations, no markdown, just the Python code.',
      maxTokens: 4096
    });

    if (!result.success) {
      throw new Error(result.error || 'Claude failed to generate fix');
    }

    // Extraer código Python de la respuesta
    return extractPythonCode(result.output);
  };
}

/**
 * Construir prompt para corrección de código
 */
function buildCorrectionPrompt(code, errorInfo) {
  return `Fix this Python code that failed with the following error:

## Error (${errorInfo.phase}):
${errorInfo.error}

${errorInfo.stderr ? `## Stderr:\n${errorInfo.stderr}\n` : ''}
${errorInfo.output ? `## Stdout:\n${errorInfo.output}\n` : ''}

## Original Code:
\`\`\`python
${code}
\`\`\`

Output ONLY the corrected Python code, no explanations.`;
}

/**
 * Extraer código Python de respuesta del agente
 */
function extractPythonCode(response) {
  // Buscar bloques de código
  const codeBlockMatch = response.match(/```(?:python)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Si no hay bloques, asumir que toda la respuesta es código
  return response.trim();
}

// ============================================================================
// MULTI-AGENT SUPPORT - Claude + Codex callbacks
// ============================================================================

const AGENT_TYPES = {
  CLAUDE: 'claude',
  CODEX: 'codex'
};

/**
 * Crear callback de agente usando Codex CLI
 * @param {function} spawnCodex - Función que ejecuta codex exec con un prompt
 */
function createCodexAgentCallback(spawnCodex) {
  return async (code, errorInfo) => {
    const prompt = buildCorrectionPrompt(code, errorInfo);

    const result = await spawnCodex(prompt, {
      systemPrompt: 'You are a Python code fixer. Fix the code and output ONLY the corrected code, nothing else. No explanations, no markdown, just the Python code.'
    });

    if (!result.success) {
      throw new Error(result.error || 'Codex failed to generate fix');
    }

    return extractPythonCode(result.output);
  };
}

/**
 * Crear callback multi-agente con fallback
 * Intenta con el agente primario; si falla, usa el secundario
 * @param {object} options - { primary: 'claude'|'codex', callbacks: { claude, codex } }
 */
function createMultiAgentCallback(options = {}) {
  const { primary = AGENT_TYPES.CLAUDE, callbacks = {} } = options;
  const secondary = primary === AGENT_TYPES.CLAUDE ? AGENT_TYPES.CODEX : AGENT_TYPES.CLAUDE;

  return async (code, errorInfo, statusCallback = () => {}) => {
    const agents = [primary, secondary].filter(a => callbacks[a]);

    for (const agentType of agents) {
      const callback = callbacks[agentType];
      if (!callback) continue;

      statusCallback({ type: 'agent_attempt', agent: agentType, phase: errorInfo.phase });

      try {
        const fixedCode = await callback(code, errorInfo);
        statusCallback({ type: 'agent_success', agent: agentType });
        return fixedCode;
      } catch (err) {
        statusCallback({ type: 'agent_failed', agent: agentType, error: err.message });
        if (agentType === agents[agents.length - 1]) {
          throw err;
        }
      }
    }

    throw new Error('No agents available for code correction');
  };
}

/**
 * Ejecutar job con auto-retry usando múltiples agentes
 * @param {string} code - Código Python inicial
 * @param {object} options - Opciones del job incluyendo agentConfig
 * @param {function} statusCallback - Función opcional para reportar progreso
 * @returns {Promise<object>} - Resultado final con historial de agentes usados
 */
async function submitWithMultiAgentRetry(code, options = {}, statusCallback = () => {}) {
  const { agentCallbacks = {}, primaryAgent = AGENT_TYPES.CLAUDE, ...jobOptions } = options;

  if (!agentCallbacks.claude && !agentCallbacks.codex) {
    return submitWithAutoRetry(code, jobOptions, null, statusCallback);
  }

  const multiCallback = createMultiAgentCallback({
    primary: primaryAgent,
    callbacks: agentCallbacks
  });

  const wrappedCallback = async (currentCode, errorInfo) => {
    return multiCallback(currentCode, errorInfo, statusCallback);
  };

  const result = await submitWithAutoRetry(code, jobOptions, wrappedCallback, statusCallback);

  return {
    ...result,
    agentConfig: {
      primaryAgent,
      availableAgents: Object.keys(agentCallbacks)
    }
  };
}

module.exports = {
  submitJob,
  getJobStatus,
  getJobOutput,
  resolveJobOutputFile,
  createJobOutputArchive,
  listJobs,
  getCachedJob,
  cleanupJob,
  cleanupAllJobs,
  getJobDetails,
  KAGGLE_USERNAME,
  // Auto-retry exports
  submitWithAutoRetry,
  pollUntilComplete,
  detectExecutionError,
  createClaudeAgentCallback,
  buildCorrectionPrompt,
  extractPythonCode,
  MAX_RETRIES,
  POLL_INTERVAL_MS,
  MAX_POLL_TIME_MS,
  // Multi-agent exports
  AGENT_TYPES,
  createCodexAgentCallback,
  createMultiAgentCallback,
  submitWithMultiAgentRetry
};
