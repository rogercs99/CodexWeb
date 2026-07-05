/**
 * Kaggle Server Adapter
 * Módulo de integración para server.js que adapta rutas y configuración en Kaggle
 */

const path = require('path');
const fs = require('fs');
const { getPathsConfig, ensureDirectories } = require('./kaggle-paths-config');
const { isKaggleEnvironment, getKaggleEnvironmentInfo } = require('./kaggle-env-detector');

/**
 * Inicializa la configuración de servidor para Kaggle
 * Debe llamarse ANTES de configurar rutas en server.js
 * @returns {Object} - Configuración adaptada
 */
function initializeKaggleAdapter() {
  const pathsConfig = getPathsConfig({
    env: process.env.NODE_ENV || 'development',
    rootDir: process.cwd()
  });

  // Crear directorios necesarios
  const dirResult = ensureDirectories(pathsConfig);

  if (!dirResult.success) {
    console.warn('[Kaggle Adapter] Some directories could not be created:', dirResult.errors);
  } else if (dirResult.created.length > 0) {
    console.log('[Kaggle Adapter] Created directories:', dirResult.created);
  }

  // Si estamos en Kaggle, sobrescribir variables de entorno
  if (pathsConfig.isKaggle) {
    console.log('[Kaggle Adapter] Running in Kaggle environment');

    // Sobrescribir rutas críticas vía process.env
    process.env.DB_PATH = pathsConfig.dbPath;
    process.env.UPLOADS_DIR = pathsConfig.uploadsDir;
    process.env.STATIC_ASSETS_DIR = pathsConfig.publicDir;
    process.env.CODEX_HOME_ROOT = path.join(pathsConfig.runtimeDir, 'codex_users');

    // Marcar como Kaggle environment
    process.env.KAGGLE_RUNTIME_MODE = 'true';
    process.env.ENVIRONMENT = 'kaggle';

    // Configurar Claude Code y Codex para modo headless
    process.env.CLAUDE_CODE_DEFAULT_CWD = pathsConfig.workspaceDir;
    process.env.CLAUDE_CODE_ALLOWED_CWDS = pathsConfig.workspaceDir;

    console.log('[Kaggle Adapter] Paths configured:', {
      db: pathsConfig.dbPath,
      uploads: pathsConfig.uploadsDir,
      public: pathsConfig.publicDir,
      workspace: pathsConfig.workspaceDir,
      runtime: pathsConfig.runtimeDir
    });
  }

  return {
    isKaggle: pathsConfig.isKaggle,
    paths: pathsConfig,
    info: pathsConfig.isKaggle ? getKaggleEnvironmentInfo() : null
  };
}

/**
 * Middleware de Express para inyectar información de Kaggle en req
 */
function kaggleMiddleware(req, res, next) {
  req.kaggle = {
    isKaggle: isKaggleEnvironment(),
    info: isKaggleEnvironment() ? getKaggleEnvironmentInfo() : null
  };
  next();
}

/**
 * Obtiene endpoints específicos de Kaggle para registrar en server.js
 * @param {Object} db - Instancia de Database (better-sqlite3)
 * @returns {Array} - Array de { method, path, handler }
 */
function getKaggleEndpoints(db) {
  return [
    {
      method: 'GET',
      path: '/api/runtime/kaggle/version',
      handler: (req, res) => {
        res.json({
          success: true,
          version: '1.0.0',
          timestamp: new Date().toISOString()
        });
      }
    },
    {
      method: 'GET',
      path: '/api/runtime/kaggle/status',
      handler: (req, res) => {
        const isKaggle = isKaggleEnvironment();
        const info = isKaggle ? getKaggleEnvironmentInfo() : null;

        res.json({
          success: true,
          isKaggle,
          environment: isKaggle ? 'kaggle' : 'vps',
          info: info,
          timestamp: new Date().toISOString()
        });
      }
    },
    {
      method: 'GET',
      path: '/api/runtime/claude/preflight',
      handler: async (req, res) => {
        // Verificar si Claude Code está disponible
        const { spawn } = require('child_process');

        try {
          const claudeBin = process.env.CLAUDE_CODE_BIN || 'claude';
          const child = spawn(claudeBin, ['--version'], {
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let output = '';
          child.stdout.on('data', (data) => { output += data.toString(); });
          child.stderr.on('data', (data) => { output += data.toString(); });

          child.on('close', (code) => {
            res.json({
              success: code === 0,
              available: code === 0,
              version: output.trim(),
              bin: claudeBin,
              timestamp: new Date().toISOString()
            });
          });

          child.on('error', (err) => {
            res.json({
              success: false,
              available: false,
              error: err.message,
              bin: claudeBin,
              timestamp: new Date().toISOString()
            });
          });
        } catch (err) {
          res.json({
            success: false,
            available: false,
            error: err.message,
            timestamp: new Date().toISOString()
          });
        }
      }
    },
    {
      method: 'GET',
      path: '/api/runtime/codex/preflight',
      handler: async (req, res) => {
        // Verificar si Codex CLI está disponible
        const { spawn } = require('child_process');

        try {
          const codexBin = 'codex';
          const child = spawn(codexBin, ['--version'], {
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let output = '';
          child.stdout.on('data', (data) => { output += data.toString(); });
          child.stderr.on('data', (data) => { output += data.toString(); });

          child.on('close', (code) => {
            res.json({
              success: code === 0,
              available: code === 0,
              version: output.trim(),
              bin: codexBin,
              timestamp: new Date().toISOString()
            });
          });

          child.on('error', (err) => {
            res.json({
              success: false,
              available: false,
              error: err.message,
              bin: codexBin,
              timestamp: new Date().toISOString()
            });
          });
        } catch (err) {
          res.json({
            success: false,
            available: false,
            error: err.message,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  ];
}

module.exports = {
  initializeKaggleAdapter,
  kaggleMiddleware,
  getKaggleEndpoints,
  // Re-export útiles
  isKaggleEnvironment,
  getKaggleEnvironmentInfo,
  getPathsConfig
};
