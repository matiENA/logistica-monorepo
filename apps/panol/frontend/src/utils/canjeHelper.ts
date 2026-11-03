import { CanjePayload } from '../types';

/**
 * Parsea el estado de canje (sea string JSON, string legacy u objeto) a estructura canónica CanjePayload
 */
export function parseCanjeStatus(raw: any, defaultQty: number = 1): CanjePayload | null {
  if (!raw) return null;

  if (typeof raw === 'object' && raw.canje !== undefined) {
    const pedida = Number(raw.cant_pedida ?? defaultQty);
    const entregada = Number(raw.cant_entregada ?? defaultQty);
    const faltante = Number(raw.cant_faltante ?? Math.max(0, pedida - entregada));
    return {
      canje: Boolean(raw.canje),
      tipo: raw.tipo || (faltante > 0 ? 'FALTANTE' : 'ENTREGO_USADA'),
      cant_pedida: pedida,
      cant_entregada: entregada,
      cant_faltante: faltante,
      motivo: raw.motivo || ''
    };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const pedida = Number(parsed.cant_pedida ?? defaultQty);
        const entregada = Number(parsed.cant_entregada ?? defaultQty);
        const faltante = Number(parsed.cant_faltante ?? Math.max(0, pedida - entregada));
        return {
          canje: Boolean(parsed.canje ?? true),
          tipo: parsed.tipo || (faltante > 0 ? 'FALTANTE' : 'ENTREGO_USADA'),
          cant_pedida: pedida,
          cant_entregada: entregada,
          cant_faltante: faltante,
          motivo: parsed.motivo || ''
        };
      } catch (_) {}
    }

    // Compatibilidad con strings legacy
    if (trimmed.toUpperCase().includes('ENTREGO_USADA') || trimmed.toUpperCase().includes('ENTREGADA')) {
      return {
        canje: true,
        tipo: 'ENTREGO_USADA',
        cant_pedida: defaultQty,
        cant_entregada: defaultQty,
        cant_faltante: 0,
        motivo: ''
      };
    }

    if (trimmed.toUpperCase().includes('FALTANTE') || trimmed.toUpperCase().includes('PENDIENTE')) {
      return {
        canje: true,
        tipo: 'FALTANTE',
        cant_pedida: defaultQty,
        cant_entregada: 0,
        cant_faltante: defaultQty,
        motivo: trimmed
      };
    }
  }

  return null;
}

/**
 * Genera texto, color e ícono legible para badges de UI
 */
export function formatCanjeBadge(payload: CanjePayload | null): { text: string; color: string; icon: string; bgClass: string; textClass: string; borderClass: string } {
  if (!payload || !payload.canje) {
    return {
      text: 'Sin Canje',
      color: 'gray',
      icon: '',
      bgClass: 'bg-slate-800/60',
      textClass: 'text-slate-400',
      borderClass: 'border-slate-700/60'
    };
  }
  if (payload.cant_faltante > 0) {
    return {
      text: `Canje: ${payload.cant_entregada}/${payload.cant_pedida} (${payload.cant_faltante} faltante${payload.cant_faltante > 1 ? 's' : ''})`,
      color: 'amber',
      icon: '⚠️',
      bgClass: 'bg-amber-950/40',
      textClass: 'text-amber-400',
      borderClass: 'border-amber-600/40'
    };
  }
  return {
    text: `Canje Completo (${payload.cant_entregada}/${payload.cant_pedida})`,
    color: 'emerald',
    icon: '♻️',
    bgClass: 'bg-emerald-950/40',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-600/40'
  };
}
