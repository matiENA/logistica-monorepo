import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const NavigationContext = createContext(null);

/**
 * Parsea la ubicación actual (pathname y searchParams) para determinar:
 * - activeTab: 'diaria' | 'flota' | 'individual'
 * - choferId: string | null
 */
export const parseLocation = () => {
  const path = window.location.pathname.toLowerCase();
  const searchParams = new URLSearchParams(window.location.search);
  const paramChofer = searchParams.get('chofer');

  // 1. Detección Legacy o Deep Link con query ?chofer=UUID
  if (paramChofer) {
    return {
      tab: 'individual',
      choferId: paramChofer.trim(),
    };
  }

  // 2. Detección por Pathname: /individual/:choferId
  if (path.startsWith('/individual/')) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      return {
        tab: 'individual',
        choferId: decodeURIComponent(segments[1]),
      };
    }
  }

  // 3. Detección por Pathname estándar
  if (path.includes('/flota')) return { tab: 'flota', choferId: null };
  if (path.includes('/individual')) return { tab: 'individual', choferId: null };
  if (path.includes('/diaria')) return { tab: 'diaria', choferId: null };

  // 4. Fallback por Query Param ?tab=...
  const paramTab = searchParams.get('tab');
  if (['diaria', 'flota', 'individual'].includes(paramTab)) {
    return { tab: paramTab, choferId: null };
  }

  // 5. Default raíz (/)
  return { tab: 'diaria', choferId: null };
};

export const NavigationProvider = ({ children }) => {
  const [navState, setNavState] = useState(() => parseLocation());

  // Escuchar eventos popstate (botones Atrás / Adelante del navegador)
  useEffect(() => {
    const handlePopState = () => {
      setNavState(parseLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  /**
   * Navega hacia una pestaña principal (/diaria, /flota, /individual)
   */
  const navigateToTab = useCallback((tabName) => {
    const validTabs = ['diaria', 'flota', 'individual'];
    const targetTab = validTabs.includes(tabName) ? tabName : 'diaria';

    const url = new URL(window.location.origin);
    url.pathname = `/${targetTab}`;

    // Si navegamos a individual y ya teníamos un chofer seleccionado, lo preservamos en la URL
    if (targetTab === 'individual' && navState.choferId) {
      url.searchParams.set('chofer', navState.choferId);
    }

    window.history.pushState({}, '', url.pathname + url.search);
    setNavState((prev) => ({
      tab: targetTab,
      choferId: targetTab === 'individual' ? prev.choferId : null,
    }));
  }, [navState.choferId]);

  /**
   * Navega directamente a la ficha de un chofer específico
   */
  const navigateToDriver = useCallback((choferId) => {
    if (!choferId) return;
    const cleanId = String(choferId).trim();

    const url = new URL(window.location.origin);
    url.pathname = '/individual';
    url.searchParams.set('chofer', cleanId);

    window.history.pushState({}, '', url.pathname + url.search);
    setNavState({
      tab: 'individual',
      choferId: cleanId,
    });
  }, []);

  /**
   * Actualiza el chofer seleccionado dentro del módulo individual sin añadir un nuevo paso de historial innecesario
   */
  const selectDriver = useCallback((choferId, { replace = false } = {}) => {
    if (!choferId) return;
    const cleanId = String(choferId).trim();

    const url = new URL(window.location.origin);
    url.pathname = '/individual';
    url.searchParams.set('chofer', cleanId);

    if (replace) {
      window.history.replaceState({}, '', url.pathname + url.search);
    } else {
      window.history.pushState({}, '', url.pathname + url.search);
    }

    setNavState({
      tab: 'individual',
      choferId: cleanId,
    });
  }, []);

  /**
   * Genera el enlace permanente canónico para compartir un chofer
   */
  const getShareableDriverUrl = useCallback((choferId) => {
    const id = choferId || navState.choferId;
    if (!id) return window.location.href;
    const url = new URL('/individual', window.location.origin);
    url.searchParams.set('chofer', id);
    return url.toString();
  }, [navState.choferId]);

  return (
    <NavigationContext.Provider
      value={{
        activeTab: navState.tab,
        selectedChoferId: navState.choferId,
        navigateToTab,
        navigateToDriver,
        selectDriver,
        getShareableDriverUrl,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation debe ser utilizado dentro de un NavigationProvider');
  }
  return context;
};
