/**
 * Estado de una cuota en lenguaje de la familia, con tonos suaves (nunca un
 * bloque rojo): pay-chip--ok | soon | late | info | neutral.
 *   Pagado · En verificación · Venció el 05 nov · Vence el 05 dic · Próxima
 */
const SOON_DAYS = 5;
const SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const shortDate = (ymd) => (ymd ? SHORT.format(new Date(`${String(ymd).slice(0, 10)}T12:00:00`)) : '');
const daysUntil = (ymd) => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${String(ymd).slice(0, 10)}T12:00:00`) - today) / 86_400_000);
};

export function statusOf(p) {
  switch (p.display_status) {
    case 'paid':
      return { tone: 'ok', label: 'Pagado' };
    case 'reported':
      return { tone: 'info', label: 'En verificación' };
    case 'overdue':
      return { tone: 'late', label: `Venció el ${shortDate(p.due_date)}` };
    case 'pending': {
      const d = p.due_date ? daysUntil(p.due_date) : null;
      if (d !== null && d <= SOON_DAYS) return { tone: 'soon', label: d === 0 ? 'Vence hoy' : d === 1 ? 'Vence mañana' : `Vence el ${shortDate(p.due_date)}` };
      return { tone: 'neutral', label: p.due_date ? `Vence el ${shortDate(p.due_date)}` : 'Por pagar' };
    }
    case 'scheduled':
      return { tone: 'neutral', label: `Próxima · vence el ${shortDate(p.due_date)}` };
    default:
      return { tone: 'neutral', label: 'Anulado' };
  }
}

/** Estado general de la cuenta (familia o un hijo) a partir de sus cuotas. */
export function accountStatus(list) {
  const overdue = list.filter((p) => p.display_status === 'overdue');
  if (overdue.length) {
    const oldest = overdue.map((p) => p.due_date).sort()[0];
    return { tone: 'late', label: overdue.length === 1 ? `Venció el ${shortDate(oldest)}` : `${overdue.length} vencidas` };
  }
  const pending = list.filter((p) => p.display_status === 'pending').sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  if (pending.length) {
    const st = statusOf(pending[0]);
    return st.tone === 'soon' ? st : { tone: 'neutral', label: `Por pagar · ${st.label.toLowerCase()}` };
  }
  if (list.some((p) => p.display_status === 'reported')) return { tone: 'info', label: 'En verificación' };
  return { tone: 'ok', label: 'Al día' };
}

/** Chip del hijo con su color fijo (FamilyContext.colorOf). */
export function ChildTag({ id, name, colorOf }) {
  if (!name) return null;
  return (
    <span className="child-tag" style={{ '--child': colorOf ? colorOf(id) : 'var(--color-primary)' }}>
      <span className="child-tag__dot" aria-hidden="true" />
      {name}
    </span>
  );
}

export { shortDate };
