import React, { useState, useMemo } from 'react';
import { Disclosure, DisclosureButton, DisclosurePanel, Transition } from '@headlessui/react';
import { ChevronDown, ChevronUp, Copy, Check, MessageCircle, AlertTriangle, Truck, ExternalLink, Calendar, ShieldAlert } from 'lucide-react';
import { getDriverDayStatus, calculateDriverReturn } from '../hooks/useDailyDrivers';
import { UnitAssignModal } from '@/features/flota/components/UnitAssignModal';
import { copyToClipboard } from '@/utils/clipboard';
import { buildUnifiedVencimientos } from '@/utils/vencimientosHelper';
import { PatenteMercosur } from '@/components/common/PatenteMercosur';

export const DailyDriverCard = ({ driver, fechaContexto, kmInfo, onSelectDriver, isRetornoMode = false }) => {
  const [copiedField, setCopiedField] = useState(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // 1. Matriz unificada de vencimientos (consumida por el badge y el acordeón)
  const vencData = useMemo(() => buildUnifiedVencimientos(driver), [driver]);

  // 2. Estado del día y fatiga para la fecha contexto
  const dayStatus = getDriverDayStatus(driver, fechaContexto);
  const displayDate = driver.dia_fecha || fechaContexto || new Date().toISOString().substring(0, 10);
  // Retorno de personal (prioriza cálculo relacional del servidor, fallback a función legacy)
  const returnInfo = driver.retorno_info
    ? {
        date: driver.retorno_info.fecha_retorno,
        diffDays: driver.retorno_info.dias_para_retorno !== undefined && driver.retorno_info.dias_para_retorno !== null
          ? driver.retorno_info.dias_para_retorno
          : (driver.retorno_info.retorna_cuando === 'HOY' ? 0 : 1),
        returnsToday: driver.retorno_info.retorna_cuando === 'HOY' || driver.retorno_info.dias_para_retorno === 0,
      }
    : calculateDriverReturn(driver, fechaContexto);

  // 2. Formato de teléfono para WhatsApp (Argentina: +54 9 ...)
  const formatWhatsApp = (tel) => {
    if (!tel) return null;
    let clean = String(tel).replace(/\D/g, '');
    if (clean.length < 6) return null;
    if (!clean.startsWith('54')) clean = '549' + clean;
    return `https://wa.me/${clean}`;
  };
  const wspCorpLink = formatWhatsApp(driver.telef_corp);
  const wspPersonalLink = formatWhatsApp(driver.telefono);
  const hasPersonalPhone = Boolean(wspPersonalLink && (!wspCorpLink || driver.telefono !== driver.telef_corp));
  const hasPhones = Boolean(wspCorpLink || hasPersonalPhone);

  // 3. Copiar al portapapeles con feedback
  const handleCopy = async (text, fieldName, e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const ok = await copyToClipboard(text, fieldName, e);
    if (ok) {
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  // 4. Semáforo cromático del Badge de Estado (gobernado por clases CSS en cards.css para soporte Light y html.dark)
  const badgeTypeClass = `day-badge-${dayStatus.type ? dayStatus.type.toLowerCase() : 'default'}`;
  const badgeFatigaClass = dayStatus.cons >= 22 ? 'fatiga-crit' : dayStatus.cons >= 18 ? 'fatiga-warn' : '';

  // Helper para fechas legibles
  const fmtDate = (d) => {
    if (!d) return 'S/D';
    return String(d).substring(0, 10).split('-').reverse().join('/');
  };

  // 5. Avatar fallback
  const avatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(driver.nombre)}&background=2563eb&color=fff&size=80`;

  return (
    <div className="daily-driver-card">
      <Disclosure>
        {({ open }) => (
          <>
            {/* Cabecera Principal de la Tarjeta */}
            <div className="daily-card-main-row">
              {/* Bloque Izquierdo: Foto + Datos del Chofer */}
              <div className="daily-card-driver-info">
                {/* Foto / Avatar con enlace al módulo individual */}
                <div
                  className="daily-card-avatar-wrap"
                  onClick={() => onSelectDriver && onSelectDriver(driver.chofer_id)}
                  title={`Ver ficha completa de ${driver.nombre}`}
                >
                  <img
                    src={driver.foto || avatarFallback}
                    alt={driver.nombre}
                    className="daily-card-avatar-img"
                    onError={(e) => { e.target.src = avatarFallback; }}
                    loading="lazy"
                  />
                </div>

                <div className="daily-card-meta">
                  {/* Nombre con EasyCopy estilo legacy (badge dashed 0.5px) */}
                  {/* Nombre con EasyCopy estilo legacy (badge dashed 1px) */}
                  <div className="daily-card-name-row">
                    <div
                      role="button"
                      tabIndex={0}
                      className={`badge-easycopy-name ${copiedField === 'nombre' ? 'copied' : ''}`}
                      onClick={(e) => handleCopy(driver.nombre, 'Nombre', e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') handleCopy(driver.nombre, 'Nombre', e);
                      }}
                      title={`Clic para copiar Nombre: ${driver.nombre}`}
                      aria-label={`Copiar nombre: ${driver.nombre}`}
                    >
                      <h3 className="daily-card-name" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                        {driver.nombre}
                      </h3>
                      {copiedField === 'nombre' ? (
                        <Check size={13} color="currentColor" />
                      ) : (
                        <Copy size={12} className="easycopy-icon" />
                      )}
                    </div>
                  </div>

                  {/* Chips: Servicio, DNI (EasyCopy) */}
                  <div className="daily-card-chips">
                    <span className="chip-badge chip-service">{driver.servicio || 'GENERAL'}</span>

                    {/* DNI EasyCopy */}
                    {driver.dni && (
                      <span
                        role="button"
                        tabIndex={0}
                        className={`badge-easycopy ${copiedField === 'dni' ? 'copied' : ''}`}
                        onClick={(e) => handleCopy(driver.dni, 'DNI', e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') handleCopy(driver.dni, 'DNI', e);
                        }}
                        title={`Clic para copiar DNI: ${driver.dni}`}
                        aria-label={`Copiar DNI: ${driver.dni}`}
                      >
                        <span>DNI: {driver.dni}</span>
                        {copiedField === 'dni' ? (
                          <Check size={11} color="currentColor" />
                        ) : (
                          <Copy size={10} className="easycopy-icon" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Slot de Comunicación: Cuadrícula fija de 88px con filas dedicadas por tipo (WCAG cross-cards alignment) */}
              <div className={`daily-card-chat-slot ${!hasPhones ? 'empty-slot' : ''}`} aria-label="Canales de comunicación">
                {/* Fila 1: Corporativo */}
                {wspCorpLink ? (
                  <a
                    href={wspCorpLink}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-whatsapp-mini"
                    title={`WhatsApp Corp: ${driver.telef_corp}`}
                    aria-label={`Enviar WhatsApp a ${driver.nombre} (Corporativo)`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MessageCircle size={11} />
                    <span>Chat Corp</span>
                  </a>
                ) : (
                  <div className="chat-slot-placeholder" aria-hidden="true" />
                )}

                {/* Fila 2: Personal */}
                {hasPersonalPhone ? (
                  <a
                    href={wspPersonalLink}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-whatsapp-mini"
                    title={`WhatsApp Personal: ${driver.telefono}`}
                    aria-label={`Enviar WhatsApp a ${driver.nombre} (Personal)`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MessageCircle size={11} />
                    <span>Chat Pers</span>
                  </a>
                ) : (
                  <div className="chat-slot-placeholder" aria-hidden="true" />
                )}
              </div>

              {/* Bloque Central: Unidad Asignada (Tractor, Semi, Reasignador y UTE) alineados a la izquierda */}
              <div className="daily-card-unit-box">
                {driver.tractor || driver.semi || driver.n_ute ? (
                  <>
                    <PatenteMercosur
                      label="TRAC"
                      fieldLabel="Tractor"
                      patente={driver.tractor}
                      variant="inline"
                    />

                    <PatenteMercosur
                      label="SEMI"
                      fieldLabel="Semi"
                      patente={driver.semi}
                      variant="inline"
                    />

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsAssignModalOpen(true);
                      }}
                      className="btn-assign-gear-mini"
                      title="Cambiar o reasignar tractor / semi"
                      aria-label="Cambiar o reasignar tractor o semi"
                    >
                      <Truck size={12} />
                    </button>

                    {driver.n_ute && (
                      <div
                        role="button"
                        tabIndex={0}
                        className={`unit-badge-pill ${copiedField === 'n_ute' ? 'copied' : ''}`}
                        onClick={(e) => handleCopy(driver.n_ute, 'UTE', e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') handleCopy(driver.n_ute, 'UTE', e);
                        }}
                        title={`Clic para copiar UTE: ${driver.n_ute}`}
                        aria-label={`Copiar UTE: ${driver.n_ute}`}
                      >
                        <span className="unit-label">UTE:</span>
                        <span className="unit-val font-mono">{driver.n_ute}</span>
                        {copiedField === 'n_ute' ? (
                          <Check size={11} color="currentColor" />
                        ) : (
                          <Copy size={10} className="easycopy-icon" />
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAssignModalOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        setIsAssignModalOpen(true);
                      }
                    }}
                    className="btn-assign-unit-dashed"
                    title="Asignar unidad operativa a este chofer"
                    aria-label="Asignar unidad operativa a este chofer"
                  >
                    <Truck size={13} />
                    <span>+ Asignar</span>
                  </div>
                )}
              </div>

              {/* Bloque Derecho: Alertas + Badge de Estado del Día + Toggle Acordeón */}
              <div className="daily-card-right-box">
                {/* Alertas Minimalistas */}
                <div className="daily-card-alerts">
                  {/* Badge Legacy: Retorna Hoy / Vuelve en Xd (solo en vista regular sin grupos H1) */}
                  {!isRetornoMode && returnInfo && (
                    <span
                      className="badge-retorno-legacy"
                      title={returnInfo.returnsToday ? 'El conductor retoma actividades hoy' : `Retoma servicio el ${returnInfo.date.substring(5).replace('-', '/')}`}
                    >
                      {returnInfo.returnsToday ? '🔄 Retorna HOY' : `🔄 Vuelve en ${returnInfo.diffDays}d`}
                    </span>
                  )}
                  {/* Badge Unificado de Vencimientos: Comparte características, clases y estados con el acordeón */}
                  {vencData.globalStatus !== 'vigente' && (
                    <span
                      className={`alert-mini-pill alert-venc-${vencData.globalStatus}`}
                      title={`Control de Vencimientos: ${vencData.badgeLabel} (${vencData.countVencidos} vencidos, ${vencData.countPorVencer} por vencer en < 1 mes). Desplegar acordeón para ver detalle.`}
                    >
                      {vencData.globalStatus === 'vencido' ? '🔴' : '🟡'} {vencData.badgeLabel}
                    </span>
                  )}
                  {kmInfo && (kmInfo.km_totales > 0 || kmInfo.hoja_ruta) && (
                    <div
                      className="daily-km-badge"
                      title={`Viaje hoy: ${kmInfo.km_totales} km${kmInfo.hoja_ruta ? ' (HR: ' + kmInfo.hoja_ruta + ')' : ''}${kmInfo.dominio ? ' • ' + kmInfo.dominio : ''}`}
                    >
                      <span className="daily-km-icon">⚡</span>
                      {kmInfo.km_totales > 0 && <span className="daily-km-val">{kmInfo.km_totales} km</span>}
                      {kmInfo.hoja_ruta && (
                        <span className="daily-km-hr">HR {kmInfo.hoja_ruta}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Badge Principal del Estado del Día (Fatiga / F / V / IND) */}
                <div
                  className={`daily-day-badge ${badgeTypeClass} ${badgeFatigaClass}`}
                  title={`Estado: ${dayStatus.raw} (${dayStatus.type}) • Fecha: ${displayDate}${driver.diagrama_tipo ? ' • Tipo: ' + driver.diagrama_tipo : ''}`}
                >
                  <span className="daily-day-badge-val">{dayStatus.raw}</span>
                  <span className="daily-day-badge-date">
                    {displayDate.substring(5).replace('-', '/')}
                  </span>
                </div>

                {/* Botón Acordeón Desplegable */}
                <DisclosureButton className="btn-card-accordion-toggle" title="Ver detalle de vencimientos y métricas" aria-label="Desplegar detalle de conductor">
                  {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </DisclosureButton>
              </div>
            </div>

            {/* Panel Desplegable con Acordeón (Detalle Completo) */}
            <Transition
              enter="transition duration-150 ease-out"
              enterFrom="transform scale-98 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-100 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-98 opacity-0"
            >
              <DisclosurePanel className="daily-card-expanded-body">
                <div className="daily-expanded-grid">
                  {/* Bloque Unificado: Merge de Conductor + Unidad consumiendo la misma matriz de vencimientos */}
                  <div className="expanded-section-box expanded-venc-unified-box">
                    <div className="unified-venc-header">
                      <h4 className="expanded-box-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                        Control de Vencimientos
                      </h4>
                      <span className={`venc-status-pill ${vencData.globalStatus}`}>
                        {vencData.globalStatus === 'vencido' && '🔴 '}
                        {vencData.globalStatus === 'por_vencer' && '🟡 '}
                        {vencData.globalStatus === 'vigente' && '🟢 '}
                        {vencData.badgeLabel}
                      </span>
                    </div>

                    <div className="unified-venc-columns">
                      {/* Sub-tabla Conductor */}
                      <div className="unified-venc-subgroup">
                        <div className="unified-venc-subgroup-title">
                          <span>👤 Documentación Conductor</span>
                        </div>
                        <div className="expanded-doc-rows">
                          {vencData.items.filter((i) => i.grupo === 'conductor').map((item) => (
                            <div key={item.id} className="expanded-doc-row">
                              <span className="doc-row-label">{item.nombre}:</span>
                              <strong
                                className={`doc-date-val ${item.status}`}
                                title={item.tooltip}
                              >
                                {item.formattedDate}
                              </strong>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Sub-tabla Unidad */}
                      <div className="unified-venc-subgroup">
                        <div className="unified-venc-subgroup-title">
                          <span>🚚 Vencimientos Unidad</span>
                        </div>
                        {vencData.tieneUnidad ? (
                          <div className="expanded-doc-rows">
                            {vencData.items.filter((i) => i.grupo === 'unidad').map((item) => (
                              <div key={item.id} className="expanded-doc-row">
                                <span className="doc-row-label">{item.nombre}:</span>
                                <strong
                                  className={`doc-date-val ${item.status}`}
                                  title={item.tooltip}
                                >
                                  {item.formattedDate}
                                </strong>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="venc-no-unit">
                            <span>⚪ Conductor sin unidad asignada (disponible)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Columna 3: Viaje y Acceso a Ficha Individual */}
                  <div className="expanded-section-box expanded-action-box">
                    {kmInfo && (kmInfo.km_totales > 0 || kmInfo.hoja_ruta) && (
                      <div className="expanded-km-summary" style={{ marginBottom: '0.75rem', padding: '0.5rem', background: 'rgba(234, 179, 8, 0.08)', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                        <div style={{ fontSize: '0.75rem', color: '#eab308', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span>⚡</span>
                          <span>Viaje registrado hoy</span>
                        </div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main, #fff)', marginTop: '2px' }}>
                          {kmInfo.km_totales > 0 ? `${kmInfo.km_totales.toLocaleString('es-AR')} km` : 'Sin KMs declarados'}
                        </div>
                        {kmInfo.hoja_ruta && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)' }}>
                            HR: {kmInfo.hoja_ruta}
                          </div>
                        )}
                        {kmInfo.dominio && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #94a3b8)' }}>
                            Tractor: {kmInfo.dominio}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectDriver && onSelectDriver(driver.chofer_id)}
                      className="btn-ver-ficha-individual"
                    >
                      <ExternalLink size={14} />
                      <span>Ver Ficha Individual</span>
                    </button>
                  </div>
                </div>
              </DisclosurePanel>
            </Transition>
          </>
        )}
      </Disclosure>

      {/* Modal Headless UI de Asignación / Desasignación con Doble Persistencia */}
      <UnitAssignModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        driver={driver}
      />
    </div>
  );
};
