import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

/**
 * Banda de bienvenida de MoDo Educa — COMPONENTE PROTEGIDO.
 *
 * Regla de diseño (DESIGN_SYSTEM.md · "Banda de bienvenida"): encabeza el
 * inicio de TODOS los portales (administración, docente y familia) y no se
 * elimina, oculta ni rediseña. Mantiene su esencia: degradado con los colores
 * de marca del colegio, esquinas redondeadas, texto blanco con jerarquía clara
 * y la fecha de hoy en una píldora translúcida a la derecha. Los estilos viven
 * en index.css (.welcome); no se sobrescriben por pantalla.
 *
 *   <WelcomeBanner subtitle="Este es el resumen de Colegio Demo." />
 *   <WelcomeBanner name="Rosa" role="Portal de familia" subtitle="Todo está al día." />
 *
 * Props
 *   name      nombre a saludar (por defecto el del usuario de la sesión)
 *   role      etiqueta del portal o rol, antes del subtítulo (opcional)
 *   subtitle  línea descriptiva o de estado (texto o nodo)
 *   emoji     por defecto 👋 (null para quitarlo)
 *   as        nivel del título (por defecto h1: es el encabezado de la página)
 */

/** Saludo según la hora local del usuario. */
export function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const DATE = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const pad = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Hora actual que se renueva cada minuto: el saludo y la fecha cambian solos (mediodía, tarde, medianoche). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function WelcomeBanner({ name, role, subtitle, emoji = '👋', as: Title = 'h1' }) {
  const { user } = useAuth();
  const now = useNow();
  const who = name ?? (user?.fullName || user?.username || '');
  return (
    <section className="welcome" aria-label="Bienvenida">
      <div className="welcome__text">
        <Title className="welcome__title">
          {greetingFor(now)}
          {who ? `, ${who}` : ''}
          {emoji ? ` ${emoji}` : ''}
        </Title>
        {(role || subtitle) && (
          <p className="welcome__subtitle">
            {role && <span className="welcome__role">{role}</span>}
            {role && subtitle ? ' · ' : ''}
            {subtitle}
          </p>
        )}
      </div>
      <time className="welcome__date" dateTime={localYmd(now)}>
        {DATE.format(now)}
      </time>
    </section>
  );
}

export default WelcomeBanner;
