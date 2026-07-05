/**
 * Kaggle Bundle Download Endpoints
 * Sirve el bundle limpio de CodexWeb para descarga desde Kaggle
 *
 * IMPORTANTE: Solo se activa si KAGGLE_BUNDLE_ENDPOINT=true
 */

const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '../../artifacts/kaggle-bundle');
const ENABLED = process.env.KAGGLE_BUNDLE_ENDPOINT === 'true';

/**
 * Obtiene información del bundle más reciente
 * @returns {Object|null} - { filename, path, sha256, manifest } o null si no existe
 */
function getLatestBundleInfo() {
  const manifestPath = path.join(BUNDLE_DIR, 'manifest.json');
  const sha256Path = path.join(BUNDLE_DIR, 'sha256.txt');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bundlePath = path.join(BUNDLE_DIR, manifest.bundle.filename);

    if (!fs.existsSync(bundlePath)) {
      return null;
    }

    let sha256 = manifest.bundle.sha256;

    // Leer SHA256 desde archivo si existe
    if (fs.existsSync(sha256Path)) {
      const sha256Content = fs.readFileSync(sha256Path, 'utf8');
      const match = sha256Content.match(/^([a-f0-9]{64})/i);
      if (match) {
        sha256 = match[1];
      }
    }

    return {
      filename: manifest.bundle.filename,
      path: bundlePath,
      sha256,
      manifest
    };
  } catch (err) {
    console.error('[Kaggle Bundle] Error reading bundle info:', err);
    return null;
  }
}

/**
 * Registra endpoints de descarga en la app Express
 * @param {Object} app - Instancia de Express
 */
function registerBundleEndpoints(app) {
  if (!ENABLED) {
    console.log('[Kaggle Bundle] Endpoints DISABLED (set KAGGLE_BUNDLE_ENDPOINT=true to enable)');
    return;
  }

  console.log('[Kaggle Bundle] Endpoints ENABLED — serving from:', BUNDLE_DIR);

  // GET /api/kaggle-bundle/status
  app.get('/api/kaggle-bundle/status', (req, res) => {
    res.json({
      success: true,
      enabled: ENABLED,
      bundleDir: BUNDLE_DIR
    });
  });

  // GET /api/kaggle-bundle/manifest
  app.get('/api/kaggle-bundle/manifest', (req, res) => {
    const info = getLatestBundleInfo();

    if (!info) {
      return res.status(404).json({
        success: false,
        error: 'No bundle found. Run scripts/create_kaggle_bundle.sh first.'
      });
    }

    res.json({
      success: true,
      manifest: info.manifest
    });
  });

  // GET /api/kaggle-bundle/sha256
  app.get('/api/kaggle-bundle/sha256', (req, res) => {
    const info = getLatestBundleInfo();

    if (!info) {
      return res.status(404).json({
        success: false,
        error: 'No bundle found'
      });
    }

    res.json({
      success: true,
      sha256: info.sha256,
      filename: info.filename
    });
  });

  // GET /api/kaggle-bundle/latest — descarga el tarball
  app.get('/api/kaggle-bundle/latest', (req, res) => {
    const info = getLatestBundleInfo();

    if (!info) {
      return res.status(404).json({
        success: false,
        error: 'No bundle found. Run scripts/create_kaggle_bundle.sh first.'
      });
    }

    // Verificar que el archivo existe
    if (!fs.existsSync(info.path)) {
      return res.status(404).json({
        success: false,
        error: 'Bundle file not found on disk'
      });
    }

    // Headers para descarga
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${info.filename}"`);
    res.setHeader('X-Bundle-SHA256', info.sha256);
    res.setHeader('X-Bundle-Version', info.manifest.version);

    // Stream el archivo
    const fileStream = fs.createReadStream(info.path);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
      console.error('[Kaggle Bundle] Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error streaming bundle'
        });
      }
    });
  });

  console.log('[Kaggle Bundle] Registered 4 endpoints:', [
    '/api/kaggle-bundle/status',
    '/api/kaggle-bundle/manifest',
    '/api/kaggle-bundle/sha256',
    '/api/kaggle-bundle/latest'
  ]);
}

module.exports = {
  registerBundleEndpoints,
  getLatestBundleInfo,
  BUNDLE_DIR,
  ENABLED
};
