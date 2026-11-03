import React, { useState, useRef, useMemo } from 'react';
import { Camera, Check, Copy, Link as LinkIcon, MessageCircle, User } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { copyToClipboard } from '@/utils/clipboard';
import { convertImageToWebP } from '@/utils/imageToWebp';
import { calcularKmCiclo, calcularCiclosComparativos } from '@/utils/dateCycleUtils';
import { PatenteMercosur } from '@/components/common/PatenteMercosur';

export const DriverProfileCard = ({ chofer, tripsMap }) => {
  const [copiedField, setCopiedField] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  if (!chofer) return null;

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

  const handleCopyLink = async (e) => {
    const choferId = chofer.chofer_id || chofer.id;
    const url = new URL('/individual', window.location.origin);
    url.searchParams.set('chofer', choferId);
    await handleCopy(url.toString(), 'link', e);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file || !chofer) return;

    try {
      setIsUploading(true);

      // 1. Convertir cualquier formato a WebP 3:4 (384x512)
      const { blob, previewUrl } = await convertImageToWebP(file, {
        maxWidth: 384,
        maxHeight: 512,
        quality: 0.82
      });

      const rawDni = chofer.dni ? String(chofer.dni).replace(/\D/g, '') : '';
      const choferId = chofer.chofer_id || chofer.id;

      // Reflejo optimista directo en TanStack Query sin useState
      queryClient.setQueryData(queryKeys.individual.detail(choferId), (old) => old ? { ...old, foto: previewUrl } : old);

      // 2. Definir nombre canónico: <DNI>.webp (o <chofer_id>.webp si no tiene DNI)
      const fileName = rawDni ? `${rawDni}.webp` : `${choferId}.webp`;

      // 3. Subir a Supabase Storage (Bucket: choferes-fotos)
      const { error: uploadErr } = await supabase.storage
        .from('choferes-fotos')
        .upload(fileName, blob, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '3600'
        });

      if (uploadErr) {
        throw new Error(`Error en Storage: ${uploadErr.message}`);
      }

      // 4. Obtener URL pública canónica con timestamp anti-caché
      const { data: urlData } = supabase.storage
        .from('choferes-fotos')
        .getPublicUrl(fileName);

      const publicUrl = urlData?.publicUrl ? `${urlData.publicUrl}?t=${Date.now()}` : null;

      if (!publicUrl) {
        throw new Error('No se pudo generar la URL pública de la imagen.');
      }

      // 5. Persistir en la tabla choferes de Supabase
      const { error: dbErr } = await supabase
        .from('choferes')
        .update({
          foto: publicUrl,
          actualizado_el: new Date().toISOString()
        })
        .eq('id', choferId);

      if (dbErr) {
        throw new Error(`Error al actualizar tabla choferes: ${dbErr.message}`);
      }

      // 6. Notificar al backend de forma asíncrona para actualizar caché RAM y respaldo en Sheets
      try {
        fetch('/api/subir-foto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dni: rawDni || chofer.dni,
            chofer_id: choferId,
            fotoUrl: publicUrl
          })
        }).catch(() => {});
      } catch (_) {}

      // 7. Invalidar queries para refrescar estado en React Query
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.individual.catalog }),
        queryClient.invalidateQueries({ queryKey: queryKeys.individual.detail(choferId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.diaria.all })
      ]);
    } catch (err) {
      console.error('❌ Error al procesar o subir foto:', err);
      alert(`No se pudo actualizar la foto: ${err.message || err}`);
      const choferId = chofer.chofer_id || chofer.id;
      queryClient.invalidateQueries({ queryKey: queryKeys.individual.detail(choferId) });
    } finally {
      setIsUploading(false);
    }
  };

  // Limpieza de teléfono para WhatsApp
  const rawTel = chofer.telefono || '';
  const numLimpio = rawTel.replace(/\D/g, '');
  const wspNum = numLimpio.startsWith('54') ? numLimpio : `549${numLimpio}`;
  const wspLink = numLimpio.length >= 8 ? `https://wa.me/${wspNum}` : null;
  const totalKm = parseFloat(chofer.total_km) || 0;

  // Cálculo reactivo de ciclos de liquidación (período actual y ciclo anterior sep 26 - oct 25)
  const ciclosData = useMemo(() => {
    if (tripsMap && Object.keys(tripsMap).length > 0) {
      return calcularCiclosComparativos(tripsMap);
    }
    return {
      actual: { km: Number(chofer?.km_ciclo) || 0, label: chofer?.ciclo_label || 'oct 26 - nov 25' },
      anterior: { km: 0, label: 'sep 26 - oct 25' }
    };
  }, [tripsMap, chofer?.km_ciclo, chofer?.ciclo_label]);

  const cicloActual = ciclosData.actual;
  const cicloAnterior = ciclosData.anterior;

  // Formato de Alta (ej: "3 DEC 2024")
  const formatAltaDate = (dateVal) => {
    if (!dateVal) return 'S/D';
    try {
      const d = new Date(dateVal);
      const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
      return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    } catch {
      return String(dateVal).substring(0, 10);
    }
  };

  return (
    <div className="driver-profile-card-master" style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg, 16px)',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-sm)'
    }}>
      
      {/* 1. SECCIÓN PRINCIPAL: FOTO + DATOS + METRICAS + UNIDADES */}
      <div style={{
        padding: '1.5rem',
        display: 'flex',
        gap: '1.5rem',
        alignItems: 'start',
        flexWrap: 'wrap'
      }}>
        
        {/* A. AVATAR 3:4 WEBP */}
        <div
          className="driver-avatar-wrapper"
          style={{ width: '135px', maxWidth: '135px', aspectRatio: '3 / 4', flexShrink: 0, borderRadius: '12px' }}
          onClick={() => fileInputRef.current?.click()}
          title="Clic para cambiar foto de perfil"
        >
          {chofer.foto ? (
            <img
              src={chofer.foto}
              alt={chofer.nombre}
              className="driver-avatar-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }}>
              <User size={42} />
              <span style={{ fontSize: '0.68rem', fontWeight: 700 }}>Sin Foto</span>
            </div>
          )}

          {/* Overlay Hover */}
          <div className="driver-avatar-overlay">
            <span className="driver-avatar-btn-label" style={{ fontSize: '0.65rem', padding: '0.25rem 0.5rem' }}>
              <Camera size={13} />
              <span>{isUploading ? 'Subiendo...' : 'Cambiar'}</span>
            </span>
            <span style={{ fontSize: '0.6rem', color: '#ffffff', opacity: 0.9 }}>WebP</span>
          </div>

          <span className="driver-avatar-badge-webp">3:4</span>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoUpload}
          />
        </div>

        {/* B. INFORMACIÓN IDENTIFICATORIA Y OPERATIVA */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: '320px' }}>
          
          {/* LÍNEA 1: NOMBRE COMPLETO + ICONO LINK COPIAR + BADGE ÚNICO CICLO (26 al 25) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h1
                className="driver-full-name"
                onClick={(e) => handleCopy(chofer.nombre, 'nombre', e)}
                title="Clic para copiar nombre"
                style={{
                  fontSize: '1.45rem',
                  fontWeight: 900,
                  color: 'var(--text-main)',
                  margin: 0,
                  letterSpacing: '-0.02em',
                  cursor: 'pointer'
                }}
              >
                {chofer.nombre}
              </h1>

              <button
                onClick={handleCopyLink}
                title="Copiar enlace permanente del conductor"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: copiedField === 'link' ? 'var(--novedad-v-text)' : 'var(--text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.2rem',
                  transition: 'color 0.15s ease'
                }}
              >
                {copiedField === 'link' ? <Check size={18} color="currentColor" /> : <LinkIcon size={18} />}
              </button>
            </div>

            {/* BADGES COMPARATIVOS DE CICLO (26 A 25) + SEGURIDAD VIAL ANUAL */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* Ciclo Anterior (sep 26 - oct 25) */}
                <div
                  className="badge-diagrama-ciclo-header badge-ciclo-anterior"
                  title={`Kilómetros del ciclo anterior de liquidación: ${cicloAnterior.label}`}
                >
                  <span className="badge-diagrama-km">
                    {cicloAnterior.km > 0
                      ? `${cicloAnterior.km.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
                      : '0,00 km'}
                  </span>
                  <span className="badge-diagrama-periodo">· {cicloAnterior.label}</span>
                </div>

                {/* Ciclo en Curso (oct 26 - nov 25) */}
                <div
                  className="badge-diagrama-ciclo-header badge-ciclo-actual"
                  title={`Kilómetros acumulados en el ciclo en curso: ${cicloActual.label}`}
                >
                  <span className="badge-diagrama-km">
                    {cicloActual.km > 0
                      ? `${cicloActual.km.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
                      : '0,00 km'}
                  </span>
                  <span className="badge-diagrama-periodo">· {cicloActual.label}</span>
                </div>
              </div>

              {/* SEGURIDAD VIAL ANUAL: ICM + ISP (debajo de los containers de KM) */}
              {chofer?.seguridad_vial_anual && (
                <div className="driver-badges-sv-anual" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div
                    className={`badge-diagrama-ciclo-header badge-sv-metric badge-sv-${chofer.seguridad_vial_anual.icm_clasificacion?.nivel || 'neutral'}`}
                    title={`Índice de Conducta de Manejo (ICM Anual): ${chofer.seguridad_vial_anual.icm_promedio !== null ? Number(chofer.seguridad_vial_anual.icm_promedio).toFixed(2) : 'S/D'} (${chofer.seguridad_vial_anual.icm_clasificacion?.label || 'Sin datos'})`}
                  >
                    <span className="badge-diagrama-km">
                      ICM {chofer.seguridad_vial_anual.icm_promedio !== null ? Number(chofer.seguridad_vial_anual.icm_promedio).toFixed(2) : 'S/D'}
                    </span>
                    <span className="badge-diagrama-periodo">· Anual {chofer.seguridad_vial_anual.anio || 2026}</span>
                  </div>

                  <div
                    className={`badge-diagrama-ciclo-header badge-sv-metric badge-sv-${chofer.seguridad_vial_anual.isp_clasificacion?.nivel || 'neutral'}`}
                    title={`Índice de Seguridad (ISP Anual): ${chofer.seguridad_vial_anual.isp_promedio !== null ? Number(chofer.seguridad_vial_anual.isp_promedio).toFixed(2) : 'S/D'} (${chofer.seguridad_vial_anual.isp_clasificacion?.label || 'Sin datos'})`}
                  >
                    <span className="badge-diagrama-km">
                      ISP {chofer.seguridad_vial_anual.isp_promedio !== null ? Number(chofer.seguridad_vial_anual.isp_promedio).toFixed(2) : 'S/D'}
                    </span>
                    <span className="badge-diagrama-periodo">· Anual {chofer.seguridad_vial_anual.anio || 2026}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* LÍNEA 2: ALTA • DNI • EMAIL • TEL • CHAT */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>
              ALTA: <strong>{formatAltaDate(chofer.fecha_alta)}</strong>
            </span>

            <span style={{ opacity: 0.4 }}>•</span>

            <span
              role="button"
              tabIndex={0}
              className={`badge-easycopy ${copiedField === 'dni' ? 'copied' : ''}`}
              onClick={(e) => handleCopy(chofer.dni, 'dni', e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleCopy(chofer.dni, 'dni', e);
              }}
              title="Clic para copiar DNI"
              aria-label={`Copiar DNI: ${chofer.dni || 'S/D'}`}
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <span>DNI: <strong>{chofer.dni || 'S/D'}</strong></span>
              {copiedField === 'dni' ? <Check size={11} color="currentColor" /> : <Copy size={11} className="easycopy-icon" />}
            </span>

            {chofer.email && (
              <>
                <span style={{ opacity: 0.4 }}>•</span>
                <span style={{ color: 'var(--text-muted)' }}>{chofer.email}</span>
              </>
            )}

            {chofer.telefono && (
              <>
                <span style={{ opacity: 0.4 }}>•</span>
                <span>TEL: <strong>{chofer.telefono}</strong></span>
              </>
            )}

            {wspLink && (
              <a
                href={wspLink}
                target="_blank"
                rel="noreferrer"
                className="btn-whatsapp-chat"
                title={`Abrir WhatsApp con ${chofer.telefono}`}
                aria-label={`Abrir WhatsApp con ${chofer.telefono}`}
              >
                <MessageCircle size={14} />
                <span>CHAT</span>
              </a>
            )}
          </div>

          {/* LÍNEA 3: 4 COLUMNAS DE UNIDAD (N° UTE INTERNO, TRACTOR, SEMI, SERVICIO) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '1rem',
            paddingTop: '0.65rem',
            borderTop: '1px solid var(--border-subtle)',
            marginTop: '0.2rem'
          }}>
            
            {/* Columna 1: N° UTE INTERNO (Dashed Badge Copiable) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="driver-unit-prop-label" style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                N° UTE INTERNO
              </span>
              <span
                role="button"
                tabIndex={0}
                className={`driver-unit-prop-val badge-easycopy ${copiedField === 'n_ute' ? 'copied' : ''}`}
                onClick={(e) => handleCopy(chofer.n_ute, 'n_ute', e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleCopy(chofer.n_ute, 'n_ute', e);
                }}
                title={`Copiar UTE: ${chofer.n_ute || '-'}`}
                aria-label={`Copiar UTE: ${chofer.n_ute || '-'}`}
              >
                <span>{chofer.n_ute || '-'}</span>
                {copiedField === 'n_ute' ? <Check size={12} color="currentColor" /> : <Copy size={11} className="easycopy-icon" />}
              </span>
            </div>

            {/* Columna 2: TRACTOR (Portapatente Dashed + Chapa Mercosur 1:1 Copiable Raw) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="driver-unit-prop-label" style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                TRACTOR
              </span>
              <PatenteMercosur
                fieldLabel="Tractor"
                patente={chofer.tractor}
                variant="field"
              />
              {chofer.marca_tr && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{chofer.marca_tr}</span>
              )}
            </div>

            {/* Columna 3: SEMI (Portapatente Dashed + Chapa Mercosur 1:1 Copiable Raw) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="driver-unit-prop-label" style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                SEMI
              </span>
              <PatenteMercosur
                fieldLabel="Semi"
                patente={chofer.semi}
                variant="field"
              />
              {chofer.marca_semi && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {chofer.marca_semi} {chofer.cisternado ? `(${chofer.cisternado})` : ''}
                </span>
              )}
            </div>

            {/* Columna 4: SERVICIO (Badge SÓLIDO, NO DASHED, NO COPIABLE) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="driver-unit-prop-label" style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                SERVICIO
              </span>
              <span className="driver-unit-service-badge">
                {chofer.servicio || 'GENERAL'}
              </span>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
};
