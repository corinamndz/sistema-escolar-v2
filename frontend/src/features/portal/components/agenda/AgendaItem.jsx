import { Link } from 'react-router-dom';
import Button from '../../../../components/ui/Button';
import Icon from '../../../../components/ui/Icon';

/**
 * Tipos de la agenda de familia. `tone` define el color (agenda-tone--*):
 * eventos azul, evaluaciones violeta, entregas verde, citas ámbar.
 */
export const AGENDA_KINDS = {
  task: { label: 'Entregas', single: 'Entrega', icon: 'upload', tone: 'task' },
  evaluation: { label: 'Evaluaciones', single: 'Evaluación', icon: 'clipboard', tone: 'evaluation' },
  event: { label: 'Eventos', single: 'Evento', icon: 'calendar', tone: 'event' },
  appointment: { label: 'Citas', single: 'Cita', icon: 'users', tone: 'appointment' },
};

/**
 * Un ítem de la agenda (evaluación, entrega, evento o cita) como tarjeta: lleva
 * a su detalle o, si es una cita pendiente, permite confirmarla aquí mismo.
 * Se usa en la lista, en el panel del día y en el detalle del móvil.
 */
export function AgendaItem({ item: i, onConfirm, confirming, highlighted = false }) {
  const meta = AGENDA_KINDS[i.kind];
  const body = (
    <>
      <span className={`agenda-item__icon agenda-tone--${meta.tone}`}>
        <Icon name={meta.icon} size={18} />
      </span>
      <span className="agenda-item__main">
        <span className="agenda-item__title">{i.title}</span>
        <span className="agenda-item__detail">
          {i.time && <>{i.time} · </>}
          {i.detail}
        </span>
      </span>
      {i.signal && <span className={`agenda-chip task-signal--${i.signal.level}`}>{i.signal.label}</span>}
      {i.done && <span className="agenda-chip agenda-chip--done">{i.kind === 'task' ? 'Entregada' : 'Calificada'}</span>}
    </>
  );
  return (
    <li className={`agenda-item ${highlighted ? 'is-highlighted' : ''}`}>
      {i.appointment ? (
        <div className="agenda-item__row">
          {body}
          {i.appointment.status === 'pending' ? (
            <Button size="sm" icon="checkCircle" onClick={() => onConfirm(i.appointment)} loading={confirming === i.appointment.id} loadingText="Confirmando…">
              Confirmar
            </Button>
          ) : (
            <span className="agenda-chip agenda-chip--done">{i.appointment.status_label}</span>
          )}
        </div>
      ) : (
        <Link to={i.to} className="agenda-item__row agenda-item__row--link">
          {body}
          <Icon name="chevronRight" size={16} className="agenda-item__chevron" />
        </Link>
      )}
    </li>
  );
}
