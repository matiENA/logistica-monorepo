const express = require('express');
const { supabase } = require('../utils/shared');
const db = require('../utils/db');

module.exports = function createAuthRouter() {
    const router = express.Router();

    router.post('/login', async (req, res) => {
        try {
            const { usuario, password } = req.body || {};
            if (!usuario || !password) {
                return res.json({ success: false, error: "Usuario y contraseña requeridos" });
            }

            const uClean = String(usuario).trim().toLowerCase();
            const pClean = String(password).trim();

            // 1. Validar contra tabla 'dash' en PostgreSQL (tabla relacional conectada al auth de la DB)
            if (db.isConfigured()) {
                try {
                    const { rows: rowsDash } = await db.query(
                        'SELECT id, nombre AS usuario, \'operador\' AS rol FROM public.dash WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1)) AND "contraseña" = $2 LIMIT 1',
                        [uClean, pClean]
                    );
                    if (rowsDash && rowsDash.length > 0) {
                        const user = rowsDash[0];
                        return res.json({ 
                            success: true, 
                            id: user.id,
                            token: 'auth_' + user.id + '_' + Date.now(), 
                            usuario: String(user.usuario).toUpperCase(), 
                            rol: user.rol,
                            fuente: 'POSTGRES_DASH'
                        });
                    }

                    // Fallback a usuarios_auth
                    const { rows } = await db.query(
                        'SELECT id, usuario, rol FROM public.usuarios_auth WHERE LOWER(TRIM(usuario)) = LOWER(TRIM($1)) AND password = $2 LIMIT 1',
                        [uClean, pClean]
                    );
                    if (rows && rows.length > 0) {
                        const user = rows[0];
                        return res.json({ 
                            success: true, 
                            id: user.id,
                            token: 'auth_' + user.id + '_' + Date.now(), 
                            usuario: String(user.usuario).toUpperCase(), 
                            rol: user.rol,
                            fuente: 'POSTGRES_USUARIOS_AUTH'
                        });
                    }
                } catch (ePg) {
                    console.error("Error consultando dash / usuarios_auth con pg client:", ePg.message);
                }
            }

            // 2. Fallback: Validar en Supabase REST Client
            try {
                const { data: userDash } = await supabase
                    .from('dash')
                    .select('id, nombre')
                    .ilike('nombre', uClean)
                    .eq('contraseña', pClean)
                    .maybeSingle();

                if (userDash) {
                    return res.json({ 
                        success: true, 
                        id: userDash.id,
                        token: 'auth_' + userDash.id + '_' + Date.now(), 
                        usuario: String(userDash.nombre).toUpperCase(), 
                        rol: 'operador',
                        fuente: 'SUPABASE_REST_DASH'
                    });
                }

                const { data: user } = await supabase
                    .from('usuarios_auth')
                    .select('id, usuario, rol')
                    .ilike('usuario', uClean)
                    .eq('password', pClean)
                    .maybeSingle();
                    
                if (user) {
                    return res.json({ 
                        success: true, 
                        id: user.id,
                        token: 'auth_' + user.id + '_' + Date.now(), 
                        usuario: String(user.usuario).toUpperCase(), 
                        rol: user.rol,
                        fuente: 'SUPABASE_REST'
                    });
                }
            } catch (eSupa) {
                console.error("Error consultando usuarios en Supabase:", eSupa);
            }

            return res.json({ success: false, error: "Usuario o contraseña incorrectos" });
        } catch (err) {
            console.error("Error en login de servidor:", err);
            return res.status(500).json({ success: false, error: "Error en login de servidor" });
        }
    });

    return router;
};
