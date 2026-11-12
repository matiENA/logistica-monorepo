/**
 * services/master-service/node_backend/routes/otsSync.js
 * Router para sincronización e ingesta de Órdenes de Trabajo (OTs) desde Google Drive a Supabase DB.
 */

const express = require('express');

// Lazy-loader para evitar fallos de inicialización al arrancar el servidor
let syncOtsPipeline = null;
function getRunPipeline() {
  if (!syncOtsPipeline) {
    syncOtsPipeline = require('../scripts/sync_ots_pipeline');
  }
  return syncOtsPipeline.runPipeline;
}

module.exports = function createOtsSyncRouter() {
  const router = express.Router();
  let isRunning = false;
  let lastReport = {
    timestamp: null,
    status: 'IDLE',
    details: null
  };

  // 1. GET /api/sync/ots/status -> Estado actual del pipeline
  router.get(['/', '/status'], (req, res) => {
    res.json({
      isRunning,
      lastReport
    });
  });

  // 2. POST /api/sync/ots/run -> Disparar ingesta de OTs
  router.post('/run', async (req, res) => {
    if (isRunning) {
      return res.status(409).json({
        success: false,
        message: 'El pipeline de sincronización de OTs ya se encuentra en ejecución.',
        lastReport
      });
    }

    const { week, dryRun, limit } = req.body || {};

    isRunning = true;
    lastReport = {
      timestamp: new Date().toISOString(),
      status: 'RUNNING',
      details: null
    };

    try {
      const runPipeline = getRunPipeline();
      const result = await runPipeline({
        week: week || req.query.week,
        dryRun: dryRun !== undefined ? Boolean(dryRun) : req.query.dryRun === 'true',
        limit: limit || req.query.limit
      });

      lastReport = {
        timestamp: new Date().toISOString(),
        status: 'SUCCESS',
        details: result
      };

      return res.json({
        success: true,
        report: lastReport
      });
    } catch (err) {
      lastReport = {
        timestamp: new Date().toISOString(),
        status: 'ERROR',
        error: err.message
      };
      console.error('[API /api/sync/ots/run] Error:', err);
      return res.status(500).json({
        success: false,
        error: err.message,
        report: lastReport
      });
    } finally {
      isRunning = false;
    }
  });

  return router;
};
