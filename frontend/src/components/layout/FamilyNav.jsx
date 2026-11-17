import { NavLink } from 'react-router-dom';
import Icon from '../ui/Icon';
import { useFamily } from '../../features/portal/FamilyContext';
import { useTeacher } from '../../features/teacher/TeacherContext';
import { initials } from './initials';

/**
 * Navegación de los portales de familia y docente en el MÓVIL: barra inferior fija con
 * los mismos 5 destinos del menú (Inicio, Académico, Agenda, Pagos, Más), con
 * ícono + etiqueta y área táctil grande. En escritorio se oculta (CSS) y queda
 * el menú lateral.
 */
export function FamilyBottomNav({ items }) {
  const family = useFamily();
  const teacher = useTeacher();
  const totals = family?.data?.totals;
  // Insignias: Pagos (familia; rojo si hay vencidas) y Calificar (docente: entregas y evaluaciones sin nota).
  const badges = {
    '/payments/mine': totals ? { n: totals.overdue_count || totals.pending_count, urgent: totals.overdue_count > 0 } : null,
    '/docente/calificar': teacher ? { n: teacher.toGradeCount, urgent: false } : null,
  };
  return (
    <nav className="family-bottom-nav" aria-label="Menú del portal">
      {items.map((item) => (
        <NavLink key={item.path} to={item.path} end={item.path === '/'} className={({ isActive }) => `family-bottom-nav__item ${isActive ? 'is-active' : ''}`}>
          <span className="family-bottom-nav__icon">
            <Icon name={item.icon} size={22} />
            {badges[item.path]?.n > 0 && (
              <span className={`nav-badge ${badges[item.path].urgent ? 'nav-badge--urgent' : ''}`} aria-label={`${badges[item.path].n} pendiente(s)`}>
                {badges[item.path].n > 9 ? '9+' : badges[item.path].n}
              </span>
            )}
          </span>
          <span>{item.short || item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Selector del hijo activo (solo con 2 o más hijos). Lo que elija se aplica a
 * Inicio, Académico y Agenda, y se recuerda en el dispositivo.
 */
export function ChildSwitcher() {
  const family = useFamily();
  if (!family || family.students.length < 2) return null;
  return (
    <div className="child-switcher" role="tablist" aria-label="Elige a tu representado">
      {family.students.map((s) => {
        const active = s.id === family.student?.id;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`child-switcher__chip ${active ? 'is-active' : ''}`}
            onClick={() => family.setStudentId(s.id)}
          >
            <span className="child-switcher__avatar" aria-hidden="true" style={{ background: family.colorOf(s.id) }}>
              {initials(`${s.first_name} ${s.last_name}`)}
            </span>
            <span className="child-switcher__text">
              <span className="child-switcher__name">{s.first_name}</span>
              <span className="child-switcher__grade">{s.grade_name || 'Sin inscripción'}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
