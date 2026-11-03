/**
 * Clasificador semántico canónico para métricas de Seguridad Vial (ICM + ISP)
 * Reglas según estándares de transporte y notas operativas:
 * 
 * ICM (Índice de Conducta de Manejo):
 *   - Verde (< 0.08): Bajo riesgo / Conducción óptima
 *   - Naranja (0.08 - 0.12): Riesgo medio / Precaución
 *   - Rojo (> 0.12): Alto riesgo / Alerta
 * 
 * ISP (Índice de Seguridad / Severidad):
 *   - Verde (< 1.20): Excelente
 *   - Naranja (1.20 - 1.50): Atención
 *   - Rojo (> 1.50): Crítico
 */

function clasificarIcm(icm) {
    if (icm === null || icm === undefined || icm === '') return null;
    const val = Number(icm);
    if (isNaN(val)) return null;

    if (val < 0.08) {
        return { nivel: 'verde', label: 'Bajo Riesgo', color: '#10b981' };
    }
    if (val <= 0.12) {
        return { nivel: 'naranja', label: 'Riesgo Medio', color: '#f59e0b' };
    }
    return { nivel: 'rojo', label: 'Alto Riesgo', color: '#ef4444' };
}

function clasificarIsp(isp) {
    if (isp === null || isp === undefined || isp === '') return null;
    const val = Number(isp);
    if (isNaN(val)) return null;

    if (val < 1.20) {
        return { nivel: 'verde', label: 'Excelente', color: '#10b981' };
    }
    if (val <= 1.50) {
        return { nivel: 'naranja', label: 'Atención', color: '#f59e0b' };
    }
    return { nivel: 'rojo', label: 'Crítico', color: '#ef4444' };
}

module.exports = {
    clasificarIcm,
    clasificarIsp
};
