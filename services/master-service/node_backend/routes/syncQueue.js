/**
 * backend/routes/syncQueue.js
 * Router integrado en eor-backend para consumo de public.eor_sync_queue hacia Google Sheets
 */

const express = require('express');
const { processSyncQueue } = require('../sync/syncQueueConsumer');
const { query } = require('../utils/db');

module.exports = function createSyncQueueRouter() {
    const router = express.Router();
    let isProcessing = false;
    let lastSyncReport = {
        timestamp: null,
        totalPending: 0,
        completed: 0,
        failed: 0,
        batchRequestsSent: 0,
        egressBytes: 0,
        executionTimeMs: 0
    };

    const MONITOR_TOKEN = process.env.UPTIMEROBOT_MONITOR_TOKEN || 'eor-sync-robot-mon-v1';

    async function executeSync({ batchLimit = 50, dryRun = false } = {}) {
        if (isProcessing) {
            return {
                status: 'ALREADY_RUNNING',
                message: 'Una sincronización de cola ya está en ejecución',
                lastSync: lastSyncReport
            };
        }

        isProcessing = true;
        try {
            const stats = await processSyncQueue({ batchLimit, dryRun });
            lastSyncReport = {
                timestamp: new Date().toISOString(),
                ...stats
            };
            return {
                status: 'SUCCESS',
                stats
            };
        } catch (err) {
            lastSyncReport = {
                timestamp: new Date().toISOString(),
                error: err.message
            };
            throw err;
        } finally {
            isProcessing = false;
        }
    }

    // 1. GET /api/sync/queue o /api/sync/queue/status -> Estado de la cola
    router.get(['/', '/status'], async (req, res) => {
        let pendingCount = 0;
        try {
            const r = await query("SELECT count(*) AS total FROM public.eor_sync_queue WHERE estado_sync = 'PENDIENTE' OR (estado_sync = 'EN_PROCESO' AND creado_el < NOW() - INTERVAL '5 minutes')");
            pendingCount = parseInt(r.rows[0]?.total || 0, 10);
        } catch (e) {
            pendingCount = -1;
        }

        return res.status(200).json({
            app: 'eor-backend (Integrated Sync Worker)',
            pendingMutations: pendingCount,
            isProcessing,
            lastSync: lastSyncReport,
            monitorToken: MONITOR_TOKEN,
            uptimeSeconds: Math.floor(process.uptime()),
            endpoints: {
                run: 'GET|POST /api/sync/queue/run?limit=50',
                uptimerobot: `/api/sync/queue/uptimerobot?token=${MONITOR_TOKEN}`,
                health: '/health'
            }
        });
    });

    // 2. GET|POST /api/sync/queue/run -> Ejecución manual o desde n8n
    router.all('/run', async (req, res) => {
        const limit = parseInt(req.query.limit || req.body?.limit || 50, 10);
        const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;

        try {
            const result = await executeSync({ batchLimit: limit, dryRun });
            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
    });

    // 3. GET /api/sync/queue/uptimerobot -> Ping de UptimeRobot que mantiene despierto el backend
    // y dispara la sincronización si hay mutaciones pendientes
    router.all('/uptimerobot', async (req, res) => {
        const token = req.query.token || req.headers['x-monitor-token'] || req.headers['authorization'];
        const tokenMatch = !token || token === MONITOR_TOKEN || token === `Bearer ${MONITOR_TOKEN}`;

        res.status(200).json({
            ok: true,
            monitorId: 'eor-backend-uptime-v1',
            service: 'eor-backend',
            tokenValid: tokenMatch,
            message: 'Ping de UptimeRobot recibido. Backend EOR activo.',
            timestamp: new Date().toISOString()
        });

        // Procesar en segundo plano si hay pendientes o stale locks
        if (!isProcessing) {
            setImmediate(async () => {
                try {
                    const r = await query("SELECT count(*) AS total FROM public.eor_sync_queue WHERE estado_sync = 'PENDIENTE' OR (estado_sync = 'EN_PROCESO' AND creado_el < NOW() - INTERVAL '5 minutes')");
                    const count = parseInt(r.rows[0]?.total || 0, 10);
                    if (count > 0) {
                        console.log(`⏰ [UptimeRobot Ping / eor-backend] ${count} mutaciones detectadas. Consumiendo...`);
                        await executeSync({ batchLimit: 50, dryRun: false });
                    }
                } catch (bgErr) {
                    console.warn('⚠️ [UptimeRobot Ping] Error en background runner:', bgErr.message);
                }
            });
        }
    });

    // 4. Polling autónomo periódico en background (cada 90s)
    const POLLING_INTERVAL_MS = 90 * 1000;
    setInterval(async () => {
        if (isProcessing) return;
        try {
            const r = await query("SELECT count(*) AS total FROM public.eor_sync_queue WHERE estado_sync = 'PENDIENTE' OR (estado_sync = 'EN_PROCESO' AND creado_el < NOW() - INTERVAL '5 minutes')");
            const count = parseInt(r.rows[0]?.total || 0, 10);
            if (count > 0) {
                console.log(`\n⚡ [Auto-Runner / eor-backend] ${count} registros pendientes en eor_sync_queue. Consumiendo...`);
                await executeSync({ batchLimit: 50, dryRun: false });
            }
        } catch (err) {
            // Silencioso si la DB está temporalmente en reposo
        }
    }, POLLING_INTERVAL_MS);

    return router;
};
