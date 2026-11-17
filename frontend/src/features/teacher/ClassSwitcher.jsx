import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/ui/Icon';
import { classLabel, subjectColor, useTeacher } from './TeacherContext';

/**
 * Selector de clase (sección + materia) del docente: una píldora bajo la barra
 * superior que abre la lista (desplegable en escritorio, hoja inferior en el
 * móvil). Arriba la clase que toca AHORA según el horario, luego las
 * recientes y todas, con buscador. Cambiar de clase conserva la pestaña.
 */
function ClassSwitcher() {
  const teacher = useTeacher();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const groups = useMemo(() => {
    if (!teacher) return [];
    const q = query.trim().toLowerCase();
    const match = (c) => !q || classLabel(c).toLowerCase().includes(q);
    const byKey = new Map(teacher.classes.map((c) => [c.key, c]));
    const now = teacher.nowClassKey && byKey.get(teacher.nowClassKey);
    const recent = teacher.recent.map((k) => byKey.get(k)).filter((c) => c && c.key !== now?.key);
    const shown = new Set([now?.key, ...recent.map((c) => c.key)]);
    const periods = [...new Set(teacher.classes.map((c) => c.school_period_name))];
    const out = [];
    if (now && match(now)) out.push({ title: 'Ahora', items: [now], now: true });
    if (recent.filter(match).length) out.push({ title: 'Recientes', items: recent.filter(match) });
    periods.forEach((p) => {
      const items = teacher.classes.filter((c) => c.school_period_name === p && match(c) && (q || !shown.has(c.key)));
      if (items.length) out.push({ title: periods.length > 1 ? `Año escolar ${p}` : 'Todas mis clases', items });
    });
    return out;
  }, [teacher, query]);

  if (!teacher || teacher.loading || !teacher.classes.length) return null;
  const active = teacher.active;
  const pick = (c) => {
    teacher.setActive(c.key);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="class-switcher" ref={ref}>
      <button type="button" className="class-switcher__btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
        <span className="class-switcher__dot" style={{ background: subjectColor(active?.subject_id) }} aria-hidden="true" />
        <span className="class-switcher__text">
          <span className="class-switcher__label">Clase</span>
          <strong>{classLabel(active)}</strong>
        </span>
        {active?.key === teacher.nowClassKey && <span className="class-switcher__now">Ahora</span>}
        <Icon name="chevronDown" size={16} />
      </button>

      {open && (
        <>
          <div className="class-switcher__backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="class-switcher__panel" role="dialog" aria-label="Elegir clase">
            <div className="class-switcher__search">
              <Icon name="search" size={16} />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar grado, sección o materia…" aria-label="Buscar clase" />
            </div>
            <div className="class-switcher__list" role="listbox">
              {groups.length === 0 && <p className="home-muted">No hay clases con ese nombre.</p>}
              {groups.map((g) => (
                <div key={g.title} className="class-switcher__group">
                  <div className="class-switcher__group-title">{g.title}</div>
                  {g.items.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      role="option"
                      aria-selected={c.key === active?.key}
                      className={`class-switcher__item ${c.key === active?.key ? 'is-active' : ''}`}
                      onClick={() => pick(c)}
                    >
                      <span className="class-switcher__dot" style={{ background: subjectColor(c.subject_id) }} aria-hidden="true" />
                      <span className="class-switcher__item-text">
                        <strong>{c.subject_name}</strong>
                        <span>
                          {c.grade_name} · Sección {c.section_name}
                        </span>
                      </span>
                      {g.now && <span className="class-switcher__now">Ahora</span>}
                      {c.key === active?.key && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ClassSwitcher;
