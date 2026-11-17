import { Link } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { usePortalViews } from '../../../lib/portalViews';
import { useFamily } from '../FamilyContext';

/**
 * «Más» del portal de familia: lo que se consulta de vez en cuando, en
 * mosaicos grandes con ícono, nombre y una línea de explicación.
 */
function MorePage() {
  const family = useFamily();
  const isOn = usePortalViews();
  if (family.loading) return <Spinner />;
  if (family.error) return <Alert>{family.error}</Alert>;
  const s = family.student;
  const of = s ? ` de ${s.first_name}` : '';
  const student = (tab) => (s ? `/portal/students/${s.id}?tab=${tab}` : null);

  const groups = [
    {
      title: s ? `Sobre ${s.first_name}` : 'Sobre tu representado',
      items: [
        { view: 'schedule', icon: 'clock', label: 'Horario de clases', hint: `El horario semanal${of}`, to: student('schedule') },
        { view: 'recognitions', icon: 'award', label: 'Reconocimientos', hint: 'Logros y certificados otorgados', to: student('recognitions') },
        { view: 'discipline', icon: 'shield', label: 'Convivencia', hint: 'Registro de faltas y llamados de atención', to: student('discipline') },
        { view: 'clubs', icon: 'star', label: 'Clubes', hint: 'Actividades extracurriculares', to: student('clubs') },
        { icon: 'user', label: 'Datos del alumno', hint: 'Cédula, grado, sección y estado de pagos', to: student('info') },
      ],
    },
    {
      title: 'Colegio',
      items: [
        { view: 'events', icon: 'calendar', label: 'Cartelera', hint: 'Todos los eventos y actividades', to: '/portal/events' },
        { icon: 'clipboard', label: 'Inscripción', hint: 'Planilla de inscripción del año', to: '/portal/enrollment' },
        { icon: 'bell', label: 'Notificaciones', hint: 'Todos los avisos que has recibido', to: '/notifications' },
      ],
    },
  ];

  return (
    <div>
      <header className="family-page-head">
        <div>
          <h1 className="family-page-head__title">Más</h1>
          <p className="family-page-head__sub">Otras secciones del portal</p>
        </div>
      </header>
      {groups.map((g) => {
        const items = g.items.filter((i) => i.to && (!i.view || isOn(i.view)));
        if (!items.length) return null;
        return (
          <section key={g.title} className="more-group">
            <h2 className="more-group__title">{g.title}</h2>
            <div className="more-grid">
              {items.map((i) => (
                <Link key={i.label} to={i.to} className="more-tile">
                  <span className="more-tile__icon">
                    <Icon name={i.icon} size={22} />
                  </span>
                  <span className="more-tile__text">
                    <span className="more-tile__label">{i.label}</span>
                    <span className="more-tile__hint">{i.hint}</span>
                  </span>
                  <Icon name="chevronRight" size={16} className="more-tile__chevron" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default MorePage;
