import Icon from '../../../components/ui/Icon';
import { KIND_LABELS, MATERIAL_TYPES, formatDuration } from '../materialTypes';
import { thumbnailUrl } from '../videoEmbed';

/** Barra de progreso accesible ("3 de 5 logrados"). */
export function ProgressBar({ progress, label, size = 'md' }) {
  const pct = Math.round(progress?.percent || 0);
  return (
    <div className={`learn-progress learn-progress--${size} ${pct === 100 ? 'is-complete' : ''}`}>
      <div className="learn-progress__head">
        {label && <span className="learn-progress__label">{label}</span>}
        <span className="learn-progress__value">
          {progress.completed} de {progress.total} · {pct}%
        </span>
      </div>
      <div className="learn-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label || 'Progreso'}>
        <div className="learn-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** "¡Lo logré!": marca o desmarca el material como estudiado (modo alumno). */
export function AchievementButton({ done, busy, onToggle, large = false }) {
  return (
    <button
      type="button"
      className={`learn-achieve ${done ? 'is-done' : ''} ${large ? 'learn-achieve--lg' : ''}`}
      onClick={onToggle}
      disabled={busy}
      aria-pressed={done}
    >
      <Icon name={done ? 'checkCircle' : 'circleDot'} size={large ? 22 : 18} />
      {done ? '¡Lo logré!' : 'Marcar como logrado'}
    </button>
  );
}

/** Estado para la familia (sin botón): logrado / visto / sin revisar. */
function FamilyStatus({ progress }) {
  if (progress.completed_at) {
    return (
      <span className="learn-status learn-status--done">
        <Icon name="checkCircle" size={14} /> Logrado
      </span>
    );
  }
  if (progress.viewed_at) {
    return (
      <span className="learn-status learn-status--viewed">
        <Icon name="eye" size={14} /> Revisado
      </span>
    );
  }
  return <span className="learn-status">Sin revisar</span>;
}

/**
 * Tarjeta de un material. `kid` = modo alumno (botón "¡Lo logré!");
 * si no, muestra a la familia si el alumno ya lo revisó.
 */
export function MaterialCard({ material: m, kid, busy, onOpen, onToggle }) {
  const t = MATERIAL_TYPES[m.type];
  const thumb = m.type === 'video' ? thumbnailUrl(m) : null;
  const done = Boolean(m.student_progress?.completed_at);
  const meta = [m.type === 'file' ? KIND_LABELS[m.kind] : t.short, formatDuration(m.duration_seconds), m.type === 'link' ? m.domain : null].filter(Boolean).join(' · ');
  return (
    <article className={`learn-card learn-tone--${t.tone} ${done ? 'is-done' : ''}`}>
      <button type="button" className="learn-card__open" onClick={onOpen} aria-label={`${t.verb}: ${m.title}`}>
        <span className="learn-card__media">
          {thumb ? (
            <>
              <img src={thumb} alt="" loading="lazy" />
              <span className="learn-card__play">
                <Icon name="play" size={22} />
              </span>
            </>
          ) : (
            <Icon name={t.icon} size={kid ? 34 : 28} />
          )}
        </span>
        <span className="learn-card__type">{meta}</span>
        <span className="learn-card__title">{m.title}</span>
        {m.description && <span className="learn-card__desc">{m.description}</span>}
      </button>
      <div className="learn-card__foot">
        <span className="learn-card__verb">
          <Icon name={m.type === 'link' ? 'externalLink' : t.icon} size={14} /> {t.verb}
        </span>
        {kid ? <AchievementButton done={done} busy={busy} onToggle={onToggle} /> : <FamilyStatus progress={m.student_progress} />}
      </div>
    </article>
  );
}
