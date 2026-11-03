const http = require('http');
const db = require('../utils/db');

async function testSubmit() {
  console.log('🧪 Iniciando prueba E2E de conexión Frontend (5173) -> Backend (5000) -> Supabase...');
  
  const payload = JSON.stringify({
    action: 'submitBatchRequest',
    args: [{
      opId: '106106',
      mechanicName: 'LUCERO CARLOS [Box 25]',
      box: '25',
      tractorPlate: 'AE617OI',
      semiPlate: 'AE494IL',
      otNumber: '11603',
      unitId: 'AE617OI / AE494IL',
      items: [
        { item: 'FILTRO DE AIRE TEST', qty: 1, notes: 'Prueba E2E Conectividad' }
      ]
    }]
  });

  const req = http.request('http://localhost:5173/api/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      console.log('✅ Respuesta RPC:', data);

      // Consultar en Supabase
      const q = await db.query(`
        SELECT 
          o.order_number, 
          o.req_code, 
          o.tractor_id, 
          o.semi_id, 
          t.patente as tractor, 
          s.patente as semi, 
          o.status,
          o.notes
        FROM panol.orders o
        LEFT JOIN public.tractores t ON o.tractor_id = t.id
        LEFT JOIN public.semis s ON o.semi_id = s.id
        ORDER BY o.created_at DESC
        LIMIT 1;
      `);
      console.log('\n📦 Último pedido registrado en Supabase:');
      console.table(q.rows);

      // Consultar renglón del ítem en panol.order_items
      const oi = await db.query(`
        SELECT oi.id, oi.quantity, oi.status, it.name as item_name, it.item_code
        FROM panol.order_items oi
        JOIN panol.items it ON oi.item_id = it.id
        ORDER BY oi.created_at DESC
        LIMIT 1;
      `);
      console.log('\n📋 Ítem de pedido en panol.order_items:');
      console.table(oi.rows);

      process.exit(0);
    });
  });

  req.on('error', err => {
    console.error('❌ Error de conexión:', err.message);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

testSubmit().catch(e => { console.error(e); process.exit(1); });
