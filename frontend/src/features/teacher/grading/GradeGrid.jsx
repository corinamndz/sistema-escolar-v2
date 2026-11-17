import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gradingApi from '../../../api/endpoints/grading.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import Modal from '../../../components/ui/Modal';
import { QUALITATIVE_LEVELS, SCALE_MAX, literalFor, literalOf } from '../../grading/gradingScale';
import { IndicatorScoreModal } from '../../grading/pages/GradebookPage';

/**
 * Libreta rápida del docente (tipo hoja de cálculo) para un plan y sección.
 *
 *   Teclado     Enter / ↓ siguiente alumno · ↑ / Shift+Enter anterior ·
 *               Tab o → al final del texto: siguiente actividad · Esc deshace
 *   Guardado    automático por celda al salir de ella o con Enter; punto gris
 *               mientras guarda, ✓ que se desvanece, ⚠ con el motivo
 *   Pegar       un bloque desde Excel / Google Sheets (filas × columnas), con
 *               vista previa antes de cargar
 *   Columna     "Rellenar vacías con…"
 *   Móvil       modo tarjeta: un alumno por pantalla, teclado numérico grande,
 *               Anterior / Siguiente o deslizar
 *
 * Las actividades por indicadores se califican en su panel (se abre desde la celda).
 * Escala cualitativa: se escribe la letra (A–E).
 */
const keyOf = (studentId, activityId) => `${studentId}:${activityId}`;

function useIsPhone() {
  const q = '(max-width: 640px)';
  const [m, setM] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

/** Texto mostrado de una nota guardada. */
function displayOf(raw, max, qualitative) {
  if (raw === null || raw === undefined) return '';
  return qualitative ? literalOf(raw, max)?.code || '' : String(Number(raw)).replace('.', ',');
}

/** Interpreta lo escrito: { ok, body, raw } o { error }. Vacío = sin cambio. */
function parseInput(text, activity, qualitative) {
  const t = String(text ?? '').trim();
  if (!t) return { empty: true };
  if (qualitative) {
    const code = t.toUpperCase();
    if (!QUALITATIVE_LEVELS.some((l) => l.code === code)) return { error: 'Usa A, B, C, D o E.' };
    const level = QUALITATIVE_LEVELS.find((l) => l.code === code);
    return { ok: true, body: { literal: code }, raw: (level.value / SCALE_MAX) * activity.max_score };
  }
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return { error: 'Escribe un número.' };
  if (n < 0 || n > activity.max_score) return { error: `Entre 0 y ${activity.max_score}.` };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { error: 'Máximo 2 decimales.' };
  return { ok: true, body: { rawScore: n }, raw: n };
}

function GradeGrid({ gradebook, onReload }) {
  const qualitative = gradebook.grading_scale === 'qualitative';
  const { activities } = gradebook;
  const students = useMemo(() => gradebook.rows.map((r) => r.student), [gradebook]);
  const isPhone = useIsPhone();
  const [mode, setMode] = useState(null); // null = automático (tarjetas en el teléfono)
  const view = mode || (isPhone ? 'cards' : 'table');

  // Notas guardadas (raw por celda) y lo escrito sin guardar.
  const [saved, setSaved] = useState(() => {
    const m = new Map();
    gradebook.rows.forEach((r) => r.scores.forEach((s) => m.set(keyOf(r.student.id, s.activityId), s.rawScore)));
    return m;
  });
  const [draft, setDraft] = useState(() => new Map());
  const [cellState, setCellState] = useState(() => new Map()); // key → 'saving' | 'saved' | { error }
  const [lastSaved, setLastSaved] = useState(null);
  const [paste, setPaste] = useState(null); // { changes, errors }
  const [fillFor, setFillFor] = useState(null); // actividad a rellenar
  const [indicator, setIndicator] = useState(null);
  const gridRef = useRef(null);

  // Recarga externa (otra sección, panel de indicadores): toma las notas nuevas.
  useEffect(() => {
    const m = new Map();
    gradebook.rows.forEach((r) => r.scores.forEach((s) => m.set(keyOf(r.student.id, s.activityId), s.rawScore)));
    setSaved(m);
    setDraft(new Map());
  }, [gradebook]);

  const setCell = (key, value) =>
    setCellState((m) => {
      const n = new Map(m);
      if (value === null) n.delete(key);
      else n.set(key, value);
      return n;
    });

  /** Guarda una celda (si cambió). Devuelve true si quedó guardada o sin cambios. */
  const saveCell = useCallback(
    async (student, activity, text) => {
      const key = keyOf(student.id, activity.id);
      const current = saved.get(key);
      const parsed = parseInput(text, activity, qualitative);
      if (parsed.empty) {
        // Borrar una nota no está permitido: se restaura la guardada.
        setDraft((d) => {
          const n = new Map(d);
          n.delete(key);
          return n;
        });
        if (current !== null && current !== undefined) setCell(key, { error: 'Una nota guardada no se puede dejar vacía.', soft: true });
        return true;
      }
      if (parsed.error) {
        setCell(key, { error: parsed.error });
        return false;
      }
      if (current !== null && current !== undefined && displayOf(current, activity.max_score, qualitative) === displayOf(parsed.raw, activity.max_score, qualitative)) {
        setDraft((d) => {
          const n = new Map(d);
          n.delete(key);
          return n;
        });
        setCell(key, null);
        return true;
      }
      setCell(key, 'saving');
      try {
        const res = await gradingApi.upsertScore(activity.id, { studentId: student.id, ...parsed.body });
        setSaved((m) => new Map(m).set(key, Number(res.raw_score ?? parsed.raw)));
        setDraft((d) => {
          const n = new Map(d);
          n.delete(key);
          return n;
        });
        setCell(key, 'saved');
        setLastSaved(Date.now());
        setTimeout(
          () =>
            setCellState((m) => {
              if (m.get(key) !== 'saved') return m;
              const n = new Map(m);
              n.delete(key);
              return n;
            }),
          1600
        );
        return true;
      } catch (err) {
        setCell(key, { error: getErrorMessage(err) });
        return false;
      }
    },
    [saved, qualitative]
  );

  const simpleCols = activities.map((a, i) => ({ a, i })).filter(({ a }) => !a.indicators.length);

  const focusCell = (row, col) => {
    const el = gridRef.current?.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (el) {
      el.focus();
      el.select?.();
    }
  };

  const onKeyDown = (e, rowIdx, colIdx, student, activity) => {
    const el = e.currentTarget;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const next = (r, c) => {
      e.preventDefault();
      saveCell(student, activity, el.value);
      focusCell(r, c);
    };
    const colPos = simpleCols.findIndex((c) => c.i === colIdx);
    if (e.key === 'Enter' && !e.shiftKey) next(rowIdx + 1, colIdx);
    else if (e.key === 'Enter' && e.shiftKey) next(rowIdx - 1, colIdx);
    else if (e.key === 'ArrowDown') next(rowIdx + 1, colIdx);
    else if (e.key === 'ArrowUp') next(rowIdx - 1, colIdx);
    else if (e.key === 'ArrowRight' && atEnd && simpleCols[colPos + 1]) next(rowIdx, simpleCols[colPos + 1].i);
    else if (e.key === 'ArrowLeft' && atStart && simpleCols[colPos - 1]) next(rowIdx, simpleCols[colPos - 1].i);
    else if (e.key === 'Escape') {
      const key = keyOf(student.id, activity.id);
      setDraft((d) => {
        const n = new Map(d);
        n.delete(key);
        return n;
      });
      setCell(key, null);
      el.blur();
    }
  };

  /** Pegar un bloque (filas × columnas) desde una hoja de cálculo. */
  const onPaste = (e, rowIdx, colIdx) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.trim())) return; // un solo valor: pegado normal
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    const startCol = simpleCols.findIndex((c) => c.i === colIdx);
    const changes = [];
    const errors = [];
    lines.forEach((line, r) => {
      const student = students[rowIdx + r];
      if (!student) return;
      line.split('\t').forEach((cell, c) => {
        const col = simpleCols[startCol + c];
        if (!col || !cell.trim()) return;
        const parsed = parseInput(cell, col.a, qualitative);
        if (parsed.error) errors.push(`${student.last_name}, ${student.first_name} · ${col.a.title}: «${cell.trim()}» (${parsed.error})`);
        else changes.push({ student, activity: col.a, text: cell.trim() });
      });
    });
    setPaste({ changes, errors });
  };

  const applyChanges = async (changes) => {
    // De a 4 en paralelo: rápido sin saturar el servidor.
    const queue = [...changes];
    const worker = async () => {
      while (queue.length) {
        const c = queue.shift();
        setDraft((d) => new Map(d).set(keyOf(c.student.id, c.activity.id), c.text));
        // eslint-disable-next-line no-await-in-loop
        await saveCell(c.student, c.activity, c.text);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  };

  const errorsCount = [...cellState.values()].filter((v) => v && typeof v === 'object' && !v.soft).length;
  const savingCount = [...cellState.values()].filter((v) => v === 'saving').length;

  /** Promedio de lo evaluado (sobre 20) con las notas en pantalla. */
  const averageOf = (studentId) => {
    let weight = 0;
    let earned = 0;
    activities.forEach((a) => {
      const raw = saved.get(keyOf(studentId, a.id));
      if (raw === null || raw === undefined) return;
      weight += Number(a.weight_percent);
      earned += (raw / a.max_score) * Number(a.weight_percent);
    });
    if (!weight) return null;
    return (earned / weight) * SCALE_MAX;
  };

  const cellProps = (student, activity, rowIdx, colIdx) => {
    const key = keyOf(student.id, activity.id);
    const raw = saved.get(key);
    const value = draft.has(key) ? draft.get(key) : displayOf(raw, activity.max_score, qualitative);
    const state = cellState.get(key);
    const low = raw !== null && raw !== undefined && raw / activity.max_score < 0.5;
    return {
      key,
      value,
      state,
      low,
      input: {
        value,
        'data-row': rowIdx,
        'data-col': colIdx,
        inputMode: qualitative ? 'text' : 'decimal',
        autoComplete: 'off',
        maxLength: qualitative ? 1 : 6,
        'aria-label': `${activity.title} · ${student.first_name} ${student.last_name}`,
        'aria-invalid': state && typeof state === 'object' && !state.soft ? true : undefined,
        onFocus: (e) => e.target.select(),
        onChange: (e) => {
          const v = qualitative ? e.target.value.toUpperCase() : e.target.value;
          setDraft((d) => new Map(d).set(key, v));
          if (state && typeof state === 'object') setCell(key, null);
        },
        onBlur: (e) => draft.has(key) && saveCell(student, activity, e.target.value),
        onKeyDown: (e) => onKeyDown(e, rowIdx, colIdx, student, activity),
        onPaste: (e) => onPaste(e, rowIdx, colIdx),
      },
    };
  };

  const header = (
    <div className="gg-bar">
      <span className={`gg-status ${errorsCount ? 'is-error' : ''}`} aria-live="polite">
        {savingCount ? (
          <>
            <span className="gg-dot" /> Guardando…
          </>
        ) : errorsCount ? (
          <>
            <Icon name="alertCircle" size={14} /> {errorsCount === 1 ? '1 nota con error' : `${errorsCount} notas con error`}
          </>
        ) : lastSaved ? (
          <>
            <Icon name="checkCircle" size={14} /> Todo guardado
          </>
        ) : (
          <>
            <Icon name="info" size={14} /> Se guarda solo al salir de cada celda
          </>
        )}
      </span>
      <div className="segmented" role="tablist" aria-label="Vista de la libreta">
        <button type="button" role="tab" aria-selected={view === 'table'} className={`segmented__item ${view === 'table' ? 'segmented__item--active' : ''}`} onClick={() => setMode('table')}>
          Tabla
        </button>
        <button type="button" role="tab" aria-selected={view === 'cards'} className={`segmented__item ${view === 'cards' ? 'segmented__item--active' : ''}`} onClick={() => setMode('cards')}>
          Tarjetas
        </button>
      </div>
    </div>
  );

  if (!activities.length) {
    return <p className="home-muted">El plan aún no tiene actividades. Agrégalas en Planificación para cargar notas.</p>;
  }
  if (!students.length) {
    return <p className="home-muted">No hay alumnos activos en esta sección.</p>;
  }

  return (
    <div className="gg">
      {header}
      {view === 'table' ? (
        <>
          <div className="gg-scroll" ref={gridRef}>
            <table className="gg-table">
              <thead>
                <tr>
                  <th className="gg-sticky">Alumno</th>
                  {activities.map((a) => (
                    <th key={a.id}>
                      <div className="gg-th">
                        <span className="gg-th__title" title={a.title}>
                          {a.title}
                        </span>
                        <span className="gg-th__meta">
                          {Number(a.weight_percent)}% · {qualitative ? 'A–E' : `/${a.max_score}`}
                          {a.indicators.length ? ` · ${a.indicators.length} ind.` : ''}
                        </span>
                        {!a.indicators.length && (
                          <button type="button" className="gg-th__menu" onClick={() => setFillFor(a)} aria-label={`Rellenar vacías de ${a.title}`} title="Rellenar vacías con…">
                            <Icon name="moreHorizontal" size={14} />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="gg-avg-h">Promedio</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, rowIdx) => {
                  const avg = averageOf(s.id);
                  return (
                    <tr key={s.id}>
                      <th scope="row" className="gg-sticky gg-name">
                        {s.last_name}, {s.first_name}
                      </th>
                      {activities.map((a, colIdx) => {
                        if (a.indicators.length) {
                          const raw = saved.get(keyOf(s.id, a.id));
                          const score = gradebook.rows.find((r) => r.student.id === s.id)?.scores.find((x) => x.activityId === a.id);
                          return (
                            <td key={a.id} className="gg-cell">
                              <button type="button" className={`score-chip ${raw !== null && raw !== undefined ? 'is-graded' : ''}`} onClick={() => setIndicator({ activity: a, student: s, score })}>
                                {raw !== null && raw !== undefined ? displayOf(raw, a.max_score, qualitative) : 'Calificar'}
                              </button>
                            </td>
                          );
                        }
                        const c = cellProps(s, a, rowIdx, colIdx);
                        return (
                          <td key={a.id} className={`gg-cell ${c.low ? 'is-low' : ''}`}>
                            <input className={`gg-input ${c.state && typeof c.state === 'object' && !c.state.soft ? 'is-error' : ''}`} {...c.input} />
                            <CellMark state={c.state} />
                          </td>
                        );
                      })}
                      <td className="gg-avg">{avg === null ? '—' : qualitative ? literalFor(avg)?.code : avg.toFixed(1).replace('.', ',')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="gg-help">
            <kbd>Enter</kbd> siguiente alumno · <kbd>Tab</kbd> siguiente actividad · <kbd>Esc</kbd> deshacer · pega una columna o un bloque desde Excel con <kbd>Ctrl</kbd>+<kbd>V</kbd>
          </p>
        </>
      ) : (
        <CardMode students={students} activities={activities} cellProps={cellProps} saved={saved} qualitative={qualitative} averageOf={averageOf} onIndicator={(a, s) => setIndicator({ activity: a, student: s, score: gradebook.rows.find((r) => r.student.id === s.id)?.scores.find((x) => x.activityId === a.id) })} />
      )}

      {paste && (
        <Modal title="Pegar notas" onClose={() => setPaste(null)} size="sm">
          <p>
            Se cargarán <strong>{paste.changes.length}</strong> {paste.changes.length === 1 ? 'nota' : 'notas'}.
            {paste.errors.length > 0 && ` ${paste.errors.length} no se cargarán por tener un valor inválido:`}
          </p>
          {paste.errors.length > 0 && (
            <ul className="gg-paste-errors">
              {paste.errors.slice(0, 8).map((er) => (
                <li key={er}>{er}</li>
              ))}
              {paste.errors.length > 8 && <li>… y {paste.errors.length - 8} más</li>}
            </ul>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setPaste(null)}>
              Cancelar
            </Button>
            <Button
              icon="check"
              disabled={!paste.changes.length}
              onClick={() => {
                const { changes } = paste;
                setPaste(null);
                applyChanges(changes);
              }}
            >
              Cargar {paste.changes.length}
            </Button>
          </div>
        </Modal>
      )}

      {fillFor && (
        <FillModal
          activity={fillFor}
          qualitative={qualitative}
          empties={students.filter((s) => {
            const raw = saved.get(keyOf(s.id, fillFor.id));
            return raw === null || raw === undefined;
          })}
          onClose={() => setFillFor(null)}
          onApply={(value, list) => {
            setFillFor(null);
            applyChanges(list.map((student) => ({ student, activity: fillFor, text: value })));
          }}
        />
      )}

      {indicator && (
        <IndicatorScoreModal
          {...indicator}
          onClose={() => setIndicator(null)}
          onSaved={() => {
            setIndicator(null);
            onReload?.();
          }}
        />
      )}
    </div>
  );
}

/** Marca sutil de la celda: guardando · guardado ✓ · error ⚠ (con el motivo). */
function CellMark({ state }) {
  if (!state) return null;
  if (state === 'saving') return <span className="gg-mark gg-mark--saving" aria-label="Guardando" />;
  if (state === 'saved') return <span className="gg-mark gg-mark--saved" aria-label="Guardado"><Icon name="check" size={11} /></span>;
  return (
    <span className={`gg-mark ${state.soft ? 'gg-mark--soft' : 'gg-mark--error'}`} role="alert" title={state.error}>
      <Icon name="alertCircle" size={12} />
      <span className="gg-mark__tip">{state.error}</span>
    </span>
  );
}

/** "Rellenar vacías con…" de una columna. */
function FillModal({ activity, qualitative, empties, onClose, onApply }) {
  const [value, setValue] = useState('');
  const parsed = parseInput(value, activity, qualitative);
  return (
    <Modal title={`Rellenar vacías · ${activity.title}`} onClose={onClose} size="sm">
      <p className="text-sm text-muted">
        {empties.length ? `Se pondrá la misma nota a ${empties.length === 1 ? '1 alumno sin nota' : `${empties.length} alumnos sin nota`}. Las notas ya cargadas no cambian.` : 'Todos los alumnos ya tienen nota en esta actividad.'}
      </p>
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(qualitative ? e.target.value.toUpperCase() : e.target.value)}
        inputMode={qualitative ? 'text' : 'decimal'}
        placeholder={qualitative ? 'A, B, C, D o E' : `De 0 a ${activity.max_score}`}
        autoFocus
        aria-label="Nota"
      />
      {parsed.error && <span className="field-error">{parsed.error}</span>}
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={!parsed.ok || !empties.length} onClick={() => onApply(value.trim(), empties)}>
          Rellenar {empties.length}
        </Button>
      </div>
    </Modal>
  );
}

/** Modo tarjeta (teléfono): un alumno por pantalla, teclado numérico grande, deslizar para cambiar. */
function CardMode({ students, activities, cellProps, saved, qualitative, averageOf, onIndicator }) {
  const [idx, setIdx] = useState(0);
  const touch = useRef(null);
  const s = students[Math.min(idx, students.length - 1)];
  const go = (d) => setIdx((i) => Math.max(0, Math.min(students.length - 1, i + d)));
  const avg = averageOf(s.id);
  return (
    <div
      className="gg-card"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 70 && !(document.activeElement?.tagName === 'INPUT')) go(dx < 0 ? 1 : -1);
      }}
    >
      <header className="gg-card__head">
        <span className="gg-card__pos">
          {idx + 1} de {students.length}
        </span>
        <strong className="gg-card__name">
          {s.last_name}, {s.first_name}
        </strong>
        <span className="gg-card__avg">Promedio: {avg === null ? '—' : qualitative ? literalFor(avg)?.code : avg.toFixed(1).replace('.', ',')}</span>
      </header>
      <ul className="gg-card__list">
        {activities.map((a, colIdx) => {
          if (a.indicators.length) {
            const raw = saved.get(`${s.id}:${a.id}`);
            return (
              <li key={a.id} className="gg-card__row">
                <span className="gg-card__act">
                  <strong>{a.title}</strong>
                  <span>
                    {Number(a.weight_percent)}% · por indicadores
                  </span>
                </span>
                <button type="button" className={`score-chip ${raw !== null && raw !== undefined ? 'is-graded' : ''}`} onClick={() => onIndicator(a, s)}>
                  {raw !== null && raw !== undefined ? displayOf(raw, a.max_score, qualitative) : 'Calificar'}
                </button>
              </li>
            );
          }
          const c = cellProps(s, a, idx, colIdx);
          return (
            <li key={a.id} className={`gg-card__row ${c.low ? 'is-low' : ''}`}>
              <span className="gg-card__act">
                <strong>{a.title}</strong>
                <span>
                  {Number(a.weight_percent)}% · {qualitative ? 'A–E' : `sobre ${a.max_score}`}
                </span>
              </span>
              <span className="gg-card__field">
                <input className={`gg-input gg-input--lg ${c.state && typeof c.state === 'object' && !c.state.soft ? 'is-error' : ''}`} {...c.input} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                <CellMark state={c.state} />
              </span>
            </li>
          );
        })}
      </ul>
      <footer className="gg-card__nav">
        <Button variant="secondary" icon="chevronLeft" onClick={() => go(-1)} disabled={idx === 0}>
          Anterior
        </Button>
        <Button onClick={() => go(1)} disabled={idx >= students.length - 1}>
          Siguiente <Icon name="chevronRight" size={16} />
        </Button>
      </footer>
    </div>
  );
}

export default GradeGrid;
