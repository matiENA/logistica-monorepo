import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Columns3, CalendarClock, ShieldAlert, Wrench, KeyRound } from 'lucide-react';

interface PlaneacionShellProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { to: '/', label: 'Kanban Base', icon: Columns3, ready: true },
  { to: '/taller', label: 'Taller (/taller)', icon: KeyRound, ready: true },
  { to: '/vencimientos', label: 'Vencimientos', icon: ShieldAlert, ready: false },
  { to: '/cronologia', label: 'Cronología', icon: CalendarClock, ready: false },
  { to: '/config', label: 'Boxes / Zonas', icon: Wrench, ready: false },
];

export const PlaneacionShell: React.FC<PlaneacionShellProps> = ({ children }) => {
  const location = useLocation();

  return (
    <div className="h-screen w-full flex flex-col bg-[#EDEDED] text-zinc-950 overflow-hidden">
      {/* Barra superior de módulos para la vista principal / */}
      <nav className="h-10 px-4 md:px-6 bg-zinc-950 text-zinc-200 flex items-center justify-between shrink-0 border-b border-zinc-800">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[11px] font-black tracking-[0.18em] uppercase text-amber-400 mr-3 shrink-0">
            PLANEACIÓN
          </span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors shrink-0 ${
                  active
                    ? 'bg-white text-zinc-950'
                    : item.ready
                    ? 'text-zinc-300 hover:text-white hover:bg-zinc-800'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {!item.ready && (
                  <span className="text-[9px] uppercase tracking-wider px-1 rounded bg-zinc-800 text-zinc-400">
                    Pronto
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
};
