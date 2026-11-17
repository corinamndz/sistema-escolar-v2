import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';
import { useTenant } from '../../../context/TenantContext';

/** Mismo texto que envía el backend al pausar las calificaciones (grades.service). */
export const GRADES_LOCKED_MESSAGE =
  'Las notas están en pausa por una mensualidad vencida. Se vuelven a ver en cuanto reportes el pago (no hace falta esperar la confirmación).';

/**
 * Notas EN PAUSA por cuotas vencidas: mensaje empático e institucional, con la
 * salida a la vista. Reportar el pago las reactiva al instante (un pago
 * reportado deja de contar como vencido), y eso se dice claramente.
 *   Ponerme al día            → Pagos, con el pago de lo vencido ya preparado
 *   Escribir a administración → correo de contacto del colegio (si lo tiene)
 */
function GradesLockedNotice({ overdueCount, studentName, compact = false, id }) {
  const { settings } = useTenant();
  const who = studentName ? `de ${studentName} ` : '';
  return (
    <section id={id} className={`grades-paused ${compact ? 'grades-paused--compact' : ''}`} aria-labelledby={id ? `${id}-title` : undefined}>
      <span className="grades-paused__icon" aria-hidden="true">
        <Icon name="pause" size={compact ? 16 : 20} />
      </span>
      <div className="grades-paused__body">
        <strong id={id ? `${id}-title` : undefined} className="grades-paused__title">
          Las notas {who}están en pausa
        </strong>
        <span className="grades-paused__text">
          {overdueCount > 0 ? `Hay ${overdueCount === 1 ? 'una mensualidad vencida' : `${overdueCount} mensualidades vencidas`}. ` : ''}
          En cuanto reportes el pago se vuelven a ver; no hace falta esperar la confirmación.
        </span>
        <div className="grades-paused__actions">
          <Link to="/payments/mine?pagar=vencidas" className="btn btn--primary btn--sm">
            <Icon name="wallet" size={15} /> Ponerme al día
          </Link>
          {settings?.contactEmail && (
            <a className="btn btn--ghost btn--sm" href={`mailto:${settings.contactEmail}?subject=${encodeURIComponent('Consulta sobre mensualidades')}`}>
              <Icon name="mail" size={15} /> Escribir a administración
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export default GradesLockedNotice;
