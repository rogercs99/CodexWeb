/**
 * Kaggle Paths Configuration
 * Configura las rutas de runtime según el entorno (VPS o Kaggle)
 */

const path = require('path');
const { isKaggleEnvironment, getKaggleEnvironmentInfo } = require('./kaggle-env-detector');

/**
 * Obtiene configuración de rutas según el entorno
 * @param {Object} options - Opciones de configuración
 * @param {string} options.env - Entorno ('production' | 'development' | 'kaggle')
 * @param {string} options.rootDir - Directorio raíz del proyecto
 * @returns {Object} - Configuración de rutas
 */
function getPathsConfig(options = {}) {
  const { env = process.env.NODE_ENV || 'development', rootDir = process.cwd() } = options;

  // Si estamos en Kaggle, usar siempre rutas Kaggle
  if (isKaggleEnvironment()) {
    const kaggleInfo = getKaggleEnvironmentInfo();
    return {
      env: 'kaggle',
      isKaggle: true,
      rootDir: kaggleInfo.paths.app,
      runtimeDir: kaggleInfo.paths.runtime,
      workspaceDir: kaggleInfo.paths.workspace,
      dbPath: kaggleInfo.paths.db,
      uploadsDir: kaggleInfo.paths.uploads,
      publicDir: kaggleInfo.paths.public,
      logsDir: path.join(kaggleInfo.paths.runtime, 'logs'),
      tempDir: '/kaggle/temp',
      // Configuraciones específicas de Kaggle
      kaggle: {
        inputDir: kaggleInfo.inputDir,
        kernelType: kaggleInfo.kernelType,
        urlBase: kaggleInfo.urlBase
      }
    };
  }

  // Configuración para VPS (producción o dev)
  const isDev = env === 'development';
  const baseRuntimeDir = isDev ? path.join(rootDir, '.runtime/dev') : path.join(rootDir, '.runtime/prod');

  return {
    env: isDev ? 'development' : 'production',
    isKaggle: false,
    rootDir,
    runtimeDir: baseRuntimeDir,
    workspaceDir: rootDir, // En VPS, el workspace es el propio proyecto
    dbPath: isDev
      ? path.join(baseRuntimeDir, 'app.dev.db')
      : path.join(rootDir, 'app.db'),
    uploadsDir: path.join(baseRuntimeDir, 'uploads'),
    publicDir: isDev
      ? path.join(baseRuntimeDir, 'public')
      : path.join(rootDir, 'public'),
    logsDir: path.join(baseRuntimeDir, 'logs'),
    tempDir: path.join(baseRuntimeDir, 'temp')
  };
}

/**
 * Crea los directorios necesarios según la configuración de rutas
 * @param {Object} pathsConfig - Configuración de rutas (resultado de getPathsConfig)
 * @returns {Object} - { success: boolean, created: string[], errors: string[] }
 */
function ensureDirectories(pathsConfig) {
  const fs = require('fs');
  const dirsToCreate = [
    pathsConfig.runtimeDir,
    pathsConfig.uploadsDir,
    pathsConfig.logsDir,
    pathsConfig.tempDir
  ];

  // En Kaggle también crear workspace
  if (pathsConfig.isKaggle) {
    dirsToCreate.push(pathsConfig.workspaceDir);
  }

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
  getPathsConfig,
  ensureDirectories
};
