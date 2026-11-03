import React, { useState, useEffect, Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { HeaderNav } from './features/navigation/HeaderNav';
import { DailyDashboard } from './features/diaria/DailyDashboard';
import { apiClient } from './api/apiClient';
import { queryKeys } from './api/queryKeys';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { LoginWall } from './components/LoginWall';
import { useRealtimeSync } from './hooks/useRealtimeSync';

// Lazy loading para división de código (Code-Splitting) y mínimo payload inicial
const FlotaModule = lazy(() => import('./features/flota/FlotaModule').then((m) => ({ default: m.FlotaModule })));
const IndividualModule = lazy(() => import('./features/individual/IndividualModule').then((m) => ({ default: m.IndividualModule })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 min en RAM por defecto
      gcTime: 1000 * 60 * 30,    // 30 min persistido en RAM
      refetchOnWindowFocus: true, // Auto-sincronización reactiva al volver a la ventana
      retry: 1,
    },
  },
});

function AppContent() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { activeTab, navigateToTab, navigateToDriver } = useNavigation();
  useRealtimeSync(); // Sincronización en vivo vía WebSockets
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Consulta ligera de badge para el encabezado (Hot RAM TTL 30s con fallback Supabase)
  const { data: badgeData } = useQuery({
    queryKey: queryKeys.auth.badge,
    queryFn: () => apiClient.getBadgePendientes(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 3,
    refetchOnWindowFocus: false,
  });

  const pendingCount = badgeData?.novedades_pendientes || 0;

  // 1. Pantalla de carga mientras se verifica token en localStorage
  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-app)',
        }}
      >
        <div className="spinner-pulse" style={{ width: '40px', height: '40px' }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 700 }}>
          Verificando sesión segura...
        </p>
      </div>
    );
  }

  // 2. Sistema Cerrado: Si no está autenticado, se bloquea tras el LoginWall
  if (!isAuthenticated || !user) {
    return <LoginWall />;
  }

  return (
    <div className="app-layout" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 1. Header con 3 Módulos Principales */}
      <HeaderNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          navigateToTab(tab);
          setIsMobileFiltersOpen(false);
        }}
        onToggleMobileFilters={() => setIsMobileFiltersOpen(!isMobileFiltersOpen)}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        pendingCount={pendingCount}
      />

      {/* 2. Cuerpo Modular Dinámico con Suspense */}
      <main style={{ flex: 1 }}>
        <Suspense
          fallback={
            <div style={{ padding: '4rem', textAlign: 'center' }}>
              <div className="spinner-pulse" />
              <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Cargando módulo en memoria...
              </p>
            </div>
          }
        >
          {activeTab === 'diaria' && (
            <DailyDashboard
              isMobileFiltersOpen={isMobileFiltersOpen}
              onCloseMobileFilters={() => setIsMobileFiltersOpen(false)}
              onNavigateToIndividual={navigateToDriver}
            />
          )}

          {activeTab === 'flota' && (
            <FlotaModule
              onNavigateToIndividual={navigateToDriver}
            />
          )}
          {activeTab === 'individual' && <IndividualModule />}
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NavigationProvider>
          <AppContent />
        </NavigationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
