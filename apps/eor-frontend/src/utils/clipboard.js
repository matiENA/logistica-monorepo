/**
 * Utilidad de portapapeles y notificaciones Toast tipo Legacy
 */

export function showLegacyToast(msg, type = 'success') {
  if (typeof document === 'undefined') return;

  // Evitar duplicados consecutivos idénticos en pantalla
  const existing = document.getElementById('eor-copy-toast');
  if (existing) existing.remove();

  const t = document.createElement('div');
  t.id = 'eor-copy-toast';
  t.style.position = 'fixed';
  t.style.bottom = '1.25rem';
  t.style.right = '1.25rem';
  t.style.padding = '0.75rem 1.25rem';
  t.style.borderRadius = '0.5rem';
  t.style.color = '#ffffff';
  t.style.fontWeight = '600';
  t.style.fontSize = '0.85rem';
  t.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2)';
  t.style.zIndex = '9999';
  t.style.display = 'flex';
  t.style.alignItems = 'center';
  t.style.gap = '0.5rem';
  t.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
  t.style.transform = 'translateY(1rem)';
  t.style.opacity = '0';
  t.style.backgroundColor = type === 'success' ? '#16a34a' : '#dc2626';

  const icon = type === 'success' ? '✅' : '⚠️';
  t.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;

  document.body.appendChild(t);

  requestAnimationFrame(() => {
    t.style.transform = 'translateY(0)';
    t.style.opacity = '1';
  });

  setTimeout(() => {
    t.style.transform = 'translateY(1rem)';
    t.style.opacity = '0';
    setTimeout(() => {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 250);
  }, 2200);
}

/**
 * Copia un valor al portapapeles y muestra confirmación visual
 * @param {string} texto - Texto a copiar
 * @param {string} [label] - Nombre descriptivo del campo (opcional)
 * @param {Event} [event] - Evento de clic para frenar propagación
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(texto, label = '', event = null) {
  if (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }

  if (!texto || texto === '-' || texto === '—' || texto === 'S/D' || texto === 's/d') {
    showLegacyToast(label ? `Sin datos para copiar en ${label}` : 'Sin datos para copiar', 'error');
    return false;
  }

  const str = String(texto).trim();

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(str);
    } else {
      // Fallback clásico
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    showLegacyToast(`Copiado: ${str}`, 'success');
    return true;
  } catch (err) {
    console.error('Error al copiar al portapapeles:', err);
    showLegacyToast('Error al copiar', 'error');
    return false;
  }
}

/**
 * Normaliza y extrae la patente argentina en formato raw data (sin espacios, guiones ni puntos):
 * - ej. "AD 337 AV" -> "AD337AV"
 * - ej. "HQK 842"   -> "HQK842"
 */
export function normalizarPatenteRaw(patenteRaw) {
  if (!patenteRaw) return '';
  const clean = String(patenteRaw).trim().toUpperCase();
  if (clean === 'S/D' || clean === '-' || clean === '—') return '';
  return clean.replace(/[\s\-_.]/g, '');
}

/**
 * Formatea una patente argentina según su formato oficial con espaciado para visualización 1:1:
 * - Mercosur (7 caracteres): XX 000 XX  (ej. AD 337 AV, AH 751 FC)
 * - Pre-Mercosur (6 caracteres): XXX 000  (ej. AAO 123, HQK 842)
 * - Histórico / 5 caracteres: XX 000
 */
export function formatearPatenteVisual(patenteRaw) {
  if (!patenteRaw) return '';
  const clean = String(patenteRaw).trim().toUpperCase();
  if (clean === 'S/D' || clean === '-' || clean === '—') return clean;

  const stripped = clean.replace(/[\s\-_.]/g, '');

  // Formato Mercosur: 2 letras, 3 dígitos, 2 letras -> XX 000 XX
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(stripped)) {
    return stripped.replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1 $2 $3');
  }

  // Formato Clásico Pre-Mercosur: 3 letras, 3 dígitos -> XXX 000
  if (/^[A-Z]{3}\d{3}$/.test(stripped)) {
    return stripped.replace(/^([A-Z]{3})(\d{3})$/, '$1 $2');
  }

  // Formato 2 letras, 3 dígitos -> XX 000
  if (/^[A-Z]{2}\d{3}$/.test(stripped)) {
    return stripped.replace(/^([A-Z]{2})(\d{3})$/, '$1 $2');
  }

  return clean;
}
