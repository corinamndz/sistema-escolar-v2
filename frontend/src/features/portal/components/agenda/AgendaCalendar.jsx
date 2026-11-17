import { useEffect, useMemo, useState } from 'react';
import Drawer from '../../../../components/ui/Drawer';
import Icon from '../../../../components/ui/Icon';
import { AGENDA_KINDS, AgendaItem } from './AgendaItem';

/**
 * Vista de calendario de la agenda de familia (convive con la lista).
 *
 *   Mes / Semana   cuadrícula de lunes a domingo
 *   Escritorio     cada día muestra píldoras de color por tipo (máx. 3 + "N más");
 *                  al tocar un día o una píldora se abre el panel del día
 *   Móvil          cada día muestra PUNTOS de color y, debajo, la lista del día
 *                  elegido (sin paneles que tapen la pantalla)
 *
 * Recibe los ítems YA filtrados por la página (hijo activo y tipo), así que
 * reacciona en tiempo real a los mismos filtros que la lista.
 */
const pad = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s) => new Date(`${s}T12:00:00`);
const addDays = (s, n) => {
  const d = fromYmd(s);
  d.setDate(d.getDate() + n);
  return toYmd(d);
};
/** Lunes de la semana de esa fecha. */
const mondayOf = (s) => {
  const d = fromYmd(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
const SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const byTime = (a, b) => String(a.time || '99').localeCompare(String(b.time || '99'));

function AgendaCalendar({ items, today, onConfirm, confirming }) {
  const compact = useMediaQuery('(max-width: 640px)');
  const [mode, setMode] = useState('month'); // month | week
  const [cursor, setCursor] = useState(today); // cualquier fecha del mes / semana visible
  const [selected, setSelected] = useState(today); // día elegido (lista inferior en el móvil)
  const [panel, setPanel] = useState(null); // { date, highlight } panel del día (escritorio)

  const byDate = useMemo(() => {
    const map = new Map();
    items.forEach((i) => map.set(i.date, [...(map.get(i.date) || []), i]));
    map.forEach((list) => list.sort(byTime));
    return map;
  }, [items]);

  const cursorDate = fromYmd(cursor);
  const monthKey = cursor.slice(0, 7);
  const start = mode === 'month' ? mondayOf(`${monthKey}-01`) : mondayOf(cursor);
  const days = Array.from({ length: mode === 'month' ? 42 : 7 }, (_, i) => addDays(start, i));
  // Mes: se omite la 6.ª semana si es toda del mes siguiente.
  const visibleDays = mode === 'month' && days.slice(35).every((d) => d.slice(0, 7) !== monthKey) ? days.slice(0, 35) : days;

  const title =
    mode === 'month'
      ? capital(MONTH.format(cursorDate))
      : `${SHORT.format(fromYmd(visibleDays[0]))} – ${SHORT.format(fromYmd(visibleDays[6]))} ${fromYmd(visibleDays[6]).getFullYear()}`;

  const move = (delta) => {
    if (mode === 'month') {
      const d = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + delta, 1, 12);
      setCursor(toYmd(d));
    } else {
      setCursor(addDays(cursor, delta * 7));
      setSelected(addDays(selected, delta * 7));
    }
  };
  const goToday = () => {
    setCursor(today);
    setSelected(today);
  };

  const openDay = (date, highlight = null) => {
    setSelected(date);
    if (!compact) setPanel({ date, highlight });
  };

  const total = (date) => byDate.get(date)?.length || 0;
  const maxPills = mode === 'week' ? 50 : 3;
  const selectedItems = byDate.get(selected) || [];

  return (
    <div className={`agenda-cal agenda-cal--${mode} ${compact ? 'agenda-cal--compact' : ''}`}>
      <div className="agenda-cal__bar">
        <div className="agenda-cal__nav">
          <button type="button" className="pc-icon-btn" onClick={() => move(-1)} aria-label={mode === 'month' ? 'Mes anterior' : 'Semana anterior'}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <h2 className="agenda-cal__title" aria-live="polite">
            {title}
          </h2>
          <button type="button" className="pc-icon-btn" onClick={() => move(1)} aria-label={mode === 'month' ? 'Mes siguiente' : 'Semana siguiente'}>
            <Icon name="chevronRight" size={18} />
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={goToday}>
            Hoy
          </button>
        </div>
        <div className="segmented" role="tablist" aria-label="Escala del calendario">
          {[
            ['month', 'Mes'],
            ['week', 'Semana'],
          ].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={mode === key} className={`segmented__item ${mode === key ? 'segmented__item--active' : ''}`} onClick={() => setMode(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="agenda-cal__legend" aria-label="Colores">
        {Object.values(AGENDA_KINDS).map((k) => (
          <li key={k.tone}>
            <span className={`agenda-cal__dot agenda-tone--${k.tone}`} aria-hidden="true" /> {k.label}
          </li>
        ))}
      </ul>

      <div className="agenda-cal__grid" role="grid" aria-label={title}>
        <div className="agenda-cal__head" role="row">
          {WEEKDAYS.map((w) => (
            <span key={w} role="columnheader" className="agenda-cal__weekday">
              {compact ? w.charAt(0) : w}
            </span>
          ))}
        </div>
        <div className="agenda-cal__days" role="rowgroup">
          {visibleDays.map((date) => {
            const list = byDate.get(date) || [];
            const outside = mode === 'month' && date.slice(0, 7) !== monthKey;
            const kinds = [...new Set(list.map((i) => i.kind))];
            const label = `${capital(LONG.format(fromYmd(date)))}${list.length ? `, ${list.length} actividad${list.length === 1 ? '' : 'es'}` : ', sin actividades'}`;
            return (
              <div
                key={date}
                role="gridcell"
                className={['agenda-cal__day', outside && 'is-outside', date === today && 'is-today', date === selected && 'is-selected', list.length && 'has-items'].filter(Boolean).join(' ')}
              >
                <button type="button" className="agenda-cal__daybtn" onClick={() => openDay(date)} aria-label={label} aria-pressed={date === selected}>
                  <span className="agenda-cal__num">{fromYmd(date).getDate()}</span>
                  {compact && kinds.length > 0 && (
                    <span className="agenda-cal__dots" aria-hidden="true">
                      {kinds.map((k) => (
                        <span key={k} className={`agenda-cal__dot agenda-tone--${AGENDA_KINDS[k].tone}`} />
                      ))}
                    </span>
                  )}
                </button>
                {!compact && (
                  <div className="agenda-cal__pills">
                    {list.slice(0, maxPills).map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className={`agenda-pill agenda-tone--${AGENDA_KINDS[i.kind].tone} ${i.done ? 'is-done' : ''}`}
                        onClick={() => openDay(date, i.id)}
                        title={`${AGENDA_KINDS[i.kind].single}: ${i.title}${i.time ? ` · ${i.time}` : ''}`}
                      >
                        {i.time && <span className="agenda-pill__time">{String(i.time).split(' ')[0]}</span>}
                        <span className="agenda-pill__text">{i.title}</span>
                      </button>
                    ))}
                    {list.length > maxPills && (
                      <button type="button" className="agenda-pill agenda-pill--more" onClick={() => openDay(date)}>
                        +{list.length - maxPills} más
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Móvil: el detalle del día elegido, debajo del calendario. */}
      {compact && (
        <section className="agenda-cal__selected" aria-live="polite">
          <h3 className="agenda-day__title">
            {selected === today ? 'Hoy · ' : ''}
            {capital(LONG.format(fromYmd(selected)))}
          </h3>
          {selectedItems.length === 0 ? (
            <p className="home-muted">No hay actividades este día.</p>
          ) : (
            <ul className="agenda-day__list">
              {selectedItems.map((i) => (
                <AgendaItem key={i.id} item={i} onConfirm={onConfirm} confirming={confirming} />
              ))}
            </ul>
          )}
        </section>
      )}

      {panel && (
        <Drawer
          title={capital(LONG.format(fromYmd(panel.date)))}
          subtitle={total(panel.date) ? `${total(panel.date)} actividad${total(panel.date) === 1 ? '' : 'es'}` : 'Sin actividades'}
          icon="calendar"
          onClose={() => setPanel(null)}
        >
          {total(panel.date) === 0 ? (
            <p className="home-muted">No hay actividades este día con los filtros elegidos.</p>
          ) : (
            <ul className="agenda-day__list">
              {(byDate.get(panel.date) || []).map((i) => (
                <AgendaItem key={i.id} item={i} onConfirm={onConfirm} confirming={confirming} highlighted={i.id === panel.highlight} />
              ))}
            </ul>
          )}
        </Drawer>
      )}
    </div>
  );
}

export default AgendaCalendar;
