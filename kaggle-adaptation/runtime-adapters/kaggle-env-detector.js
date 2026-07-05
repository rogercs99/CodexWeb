/**
 * Kaggle Environment Detector
 * Detecta si CodexWeb está ejecutándose dentro de un runtime efímero de Kaggle
 */

const fs = require('fs');
const path = require('path');

/**
 * Detecta si el proceso está corriendo en un entorno Kaggle
 * @returns {boolean}
 */
function isKaggleEnvironment() {
  // 1. Verificar existencia de /kaggle/working
  const kaggleWorkingExists = fs.existsSync('/kaggle/working');

  // 2. Verificar variables de entorno típicas de Kaggle
  const hasKaggleEnvVars = !!(
    process.env.KAGGLE_KERNEL_RUN_TYPE ||
    process.env.KAGGLE_URL_BASE ||
    process.env.KAGGLE_KERNEL_INTEGRATIONS
  );

  // 3. Verificar archivo /kaggle/input (típico en kernels)
  const kaggleInputExists = fs.existsSync('/kaggle/input');

  return kaggleWorkingExists || hasKaggleEnvVars || kaggleInputExists;
}

/**
 * Obtiene información detallada del entorno Kaggle
 * @returns {Object}
 */
function getKaggleEnvironmentInfo() {
  if (!isKaggleEnvironment()) {
    return {
      isKaggle: false,
      reason: 'No Kaggle environment detected'
    };
  }

  return {
    isKaggle: true,
    workingDir: '/kaggle/working',
    inputDir: '/kaggle/input',
    tempDir: '/kaggle/temp',
    kernelType: process.env.KAGGLE_KERNEL_RUN_TYPE || 'unknown',
    urlBase: process.env.KAGGLE_URL_BASE || null,
    // Rutas calculadas para CodexWeb en Kaggle
    paths: {
      app: '/kaggle/working/codexweb-app',
      runtime: '/kaggle/working/codexweb-runtime',
      workspace: '/kaggle/working/workspace',
      db: '/kaggle/working/codexweb-runtime/app.kaggle.db',
      uploads: '/kaggle/working/codexweb-runtime/uploads',
      public: '/kaggle/working/codexweb-app/public'
    }
  };
}

/**
 * Obtiene la ruta de runtime apropiada según el entorno
 * @param {string} defaultPath - Ruta por defecto (para entornos no-Kaggle)
 * @returns {string}
 */
function getRuntimePath(defaultPath) {
  if (isKaggleEnvironment()) {
    return '/kaggle/working/codexweb-runtime';
  }
  return defaultPath;
}

/**
 * Obtiene la ruta de workspace apropiada según el entorno
 * @returns {string}
 */
function getWorkspacePath() {
  if (isKaggleEnvironment()) {
    return '/kaggle/working/workspace';
  }
  return process.cwd(); // Fallback a directorio actual
}

/**
 * Crea los directorios necesarios para el entorno Kaggle
 * @returns {Object} - { success: boolean, created: string[], errors: string[] }
 */
function ensureKaggleDirectories() {
  if (!isKaggleEnvironment()) {
    return {
      success: false,
      created: [],
      errors: ['Not in Kaggle environment']
    };
  }

  const info = getKaggleEnvironmentInfo();
  const dirsToCreate = Object.values(info.paths).filter(p => !p.endsWith('.db'));

  const created = [];
  const errors = [];

  for (const dir of dirsToCreate) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    } catch (err) {
      errors.push(`Failed to create ${dir}: ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    created,
    errors
  };
}

module.exports = {
  isKaggleEnvironment,
  getKaggleEnvironmentInfo,
  getRuntimePath,
  getWorkspacePath,
  ensureKaggleDirectories
};
