import React from 'react';
import {
  ArrowLeft,
  CheckSquare,
  Home,
  LayoutGrid,
  LogOut,
  MapPin,
  QrCode,
  type LucideIcon,
} from 'lucide-react';
import type { EncargadoZonaSession } from '../../services/qrApi';

export type FieldSection = 'menu' | 'ingreso' | 'llegada' | 'boxes' | 'salida';

interface QrMobileShellProps {
  section: FieldSection;
  title: string;
  user: EncargadoZonaSession;
  onSelectSection: (next: FieldSection) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const BOTTOM_NAV_ITEMS: ReadonlyArray<{
  id: FieldSection;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: 'menu', label: 'Inicio', Icon: Home },
  { id: 'llegada', label: 'Llegada', Icon: MapPin },
  { id: 'boxes', label: 'Boxes', Icon: LayoutGrid },
  { id: 'salida', label: 'Salida', Icon: CheckSquare },
];

export const QrMobileShell: React.FC<QrMobileShellProps> = ({
  section,
  title,
  user,
  onSelectSection,
  onLogout,
  children,
}) => {
  const showBack = section !== 'menu';

  return (
    <div className="min-h-screen bg-[#070A0F] text-[#F8FAFC] flex flex-col">
      {/* Header compacto (56px, regla 60-30-10, target táctil >= 44px) */}
      <header className="sticky top-0 z-20 h-14 bg-[#11161F] border-b border-slate-700/80 px-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showBack ? (
            <button
              type="button"
              onClick={() => onSelectSection('menu')}
              aria-label="Volver al menú principal"
              className="w-11 h-11 rounded-lg border border-transparent hover:bg-slate-800 active:scale-[0.98] text-slate-200 flex items-center justify-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2} aria-hidden="true" focusable="false" />
            </button>
          ) : (
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 ml-1">
              <QrCode className="w-5 h-5" strokeWidth={2} aria-hidden="true" focusable="false" />
            </div>
          )}

          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-white truncate leading-tight">
              {title}
            </h1>
            <p className="text-xs text-slate-300 truncate leading-tight">
              {user.zone_name ? `${user.zone_name} · ` : ''}
              {user.nombre_usuario}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          aria-label="Cerrar sesión"
          className="h-11 px-3 rounded-lg border border-slate-600 bg-transparent hover:bg-slate-800 active:scale-[0.98] text-slate-100 text-sm font-medium inline-flex items-center gap-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
        >
          <LogOut className="w-4 h-4" strokeWidth={2} aria-hidden="true" focusable="false" />
          <span>Salir</span>
        </button>
      </header>

      {/* Área de contenido principal con margen inferior seguro sobre Bottom Nav */}
      <main className="flex-1 flex flex-col justify-center px-4 pt-4 pb-24 max-w-md w-full mx-auto">
        {children}
      </main>

      {/* Bottom Navigation Bar fija (64px + safe-area, 4 ítems >= 48px, WCAG 2.2) */}
      <nav
        aria-label="Navegación principal de campo"
        className="fixed bottom-0 inset-x-0 z-30 bg-[#11161F] border-t border-slate-700/90 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="max-w-md mx-auto grid grid-cols-4 h-16 px-1">
          {BOTTOM_NAV_ITEMS.map(({ id, label, Icon }) => {
            const isActive =
              section === id || (id === 'menu' && section === 'ingreso');
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectSection(id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative min-h-[48px] flex flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-inset ${
                  isActive
                    ? 'text-emerald-400'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 inset-x-4 h-[2px] rounded-full bg-emerald-400"
                  />
                )}
                <Icon className="w-5 h-5" strokeWidth={2} aria-hidden={true} />
                <span className="leading-none truncate max-w-full px-1">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
