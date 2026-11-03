const db = require('../utils/db');

async function main() {
  const sql = `
    CREATE OR REPLACE VIEW panol.v_flota_busqueda AS
    SELECT 
      u.id AS unidad_id,
      u.n_ute,
      COALESCE(t.patente, '') AS tractor,
      COALESCE(t.marca, '') AS marca_tr,
      COALESCE(s.patente, '') AS semi,
      COALESCE(s.marca, '') AS marca_semi,
      COALESCE(su.denominacion, 'GENERAL') AS servicio,
      COALESCE(u.estado, 'disponible') AS estado_unidad,
      COALESCE(wot.id, wos.id) AS active_work_order_id,
      COALESCE(wot.ot_number, wos.ot_number) AS active_ot_number,
      COALESCE(wot.status, wos.status) AS active_ot_status,
      wot.ot_number AS tractor_ot,
      wos.ot_number AS semi_ot
    FROM public.unidades u
    LEFT JOIN public.tractores t ON u.tractor_id = t.id
    LEFT JOIN public.semis s ON u.semi_id = s.id
    LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
    LEFT JOIN LATERAL (
      SELECT id, ot_number, status
      FROM panol.work_orders
      WHERE (tractor_id = t.id OR (applied_to = 'TRACTOR' AND unidad_id = u.id))
        AND status IN ('ABIERTA', 'ACTIVA', 'EN_PROCESO', 'ESPERA_REPUESTO')
      ORDER BY created_at DESC
      LIMIT 1
    ) wot ON true
    LEFT JOIN LATERAL (
      SELECT id, ot_number, status
      FROM panol.work_orders
      WHERE (semi_id = s.id OR (applied_to = 'SEMI' AND unidad_id = u.id))
        AND status IN ('ABIERTA', 'ACTIVA', 'EN_PROCESO', 'ESPERA_REPUESTO')
      ORDER BY created_at DESC
      LIMIT 1
    ) wos ON true;

    CREATE OR REPLACE VIEW public.v_flota_busqueda AS
    SELECT * FROM panol.v_flota_busqueda;
  `;

  await db.query(sql);
  console.log('✅ Views updated successfully.');
  const test = await db.query('SELECT tractor, tractor_ot, semi, semi_ot FROM panol.v_flota_busqueda WHERE tractor_ot IS NOT NULL OR semi_ot IS NOT NULL LIMIT 5;');
  console.log('Sample rows:', test.rows);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ Error updating views:', err);
  process.exit(1);
});
