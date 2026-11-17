import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import ErrorBoundary from '../ErrorBoundary';
import SchoolFooter from './SchoolFooter';
import LoginNoticeModal from './LoginNoticeModal';
import { ChildSwitcher, FamilyBottomNav } from './FamilyNav';
import { TEACHER_NAV, familyNavItems, isFamilyUser, isTeacherPortalUser } from './navigation';
import { TeacherProvider } from '../../features/teacher/TeacherContext';
import ClassSwitcher from '../../features/teacher/ClassSwitcher';
import { FamilyProvider } from '../../features/portal/FamilyContext';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';

const COLLAPSED_KEY = 'ui.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function AppLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed); // desktop: angosto/ancho (se recuerda entre sesiones)
  const [mobileOpen, setMobileOpen] = useState(false); // mobile: drawer abierto/cerrado
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { settings } = useTenant();
  // Portal de familia: hijo activo compartido, selector de hijo y barra inferior en el móvil.
  const family = isFamilyUser(user);
  const familyItems = family ? familyNavItems(settings.portalViews) : [];
  // Pantallas donde el hijo activo decide lo que se ve.
  const showSwitcher = family && (pathname === '/' || /^\/portal\/(academico|agenda|mas)/.test(pathname));
  // Portal del docente: clase activa compartida, selector de clase y barra inferior.
  const teacherPortal = isTeacherPortalUser(user);
  const showClassSwitcher = teacherPortal && /^\/docente\/(clase|planificacion)/.test(pathname);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // almacenamiento no disponible (modo privado): solo no se recuerda la preferencia
    }
  }, [collapsed]);

  // Cerrar el drawer al cambiar de ruta y volver arriba en la página nueva.
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  // Mientras el drawer móvil está abierto: bloquear el scroll de fondo y cerrar con Escape.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [mobileOpen]);

  const shell = (
    <div className={`app-shell ${family || teacherPortal ? 'app-shell--family' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />

      <div className={`app-main ${collapsed ? 'app-main--collapsed' : ''}`}>
        <Topbar onOpenMobileSidebar={() => setMobileOpen(true)} />
        {/* Notificaciones sin leer: aviso una vez por inicio de sesión. */}
        <LoginNoticeModal />
        {showSwitcher && <ChildSwitcher />}
        {showClassSwitcher && <ClassSwitcher />}
        <main className="app-content" key={pathname}>
          {/* Si una pantalla falla al dibujarse, se muestra un aviso (no la app en blanco). */}
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
        {/* Pie de página del inicio: al final de la columna, siempre al fondo de la vista. */}
        {pathname === '/' && <SchoolFooter />}
      </div>

      {mobileOpen && <div className="app-overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      {family && <FamilyBottomNav items={familyItems} />}
      {teacherPortal && <FamilyBottomNav items={TEACHER_NAV} />}
    </div>
  );
  if (family) return <FamilyProvider>{shell}</FamilyProvider>;
  return teacherPortal ? <TeacherProvider>{shell}</TeacherProvider> : shell;
}

export default AppLayout;
