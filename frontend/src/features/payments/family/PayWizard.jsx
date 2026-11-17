import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import paymentsApi from '../../../api/endpoints/payments.api';
import portalApi from '../../../api/endpoints/portal.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import FileDropzone from '../../../components/ui/FileDropzone';
import { ConversionBreakdown, REPORT_METHODS, formatAmounts, formatDate, formatMoney } from '../paymentStatus';
import { CurrencySelect } from '../currency';
import { refTotal, totalsOf } from '../components/StudentPaymentsSection';
import { isAdvance, isDue, toggleInOrder } from '../components/BatchPayment';
import PaymentInstructions from '../components/PaymentInstructions';
import { ChildTag, statusOf } from './payStatus';

/**
 * Pagar (portal de familia): UN solo flujo para una o varias cuotas, de uno o
 * varios hijos, en 4 pasos y una pantalla de éxito.
 *   1. Qué pagas    lo exigible viene marcado; se pueden adelantar meses
 *   2. Cómo pagas   método en tarjetas + datos del colegio con «Copiar»
 *   3. Datos        monto calculado (no se escribe), fecha (hoy), referencia
 *   4. Comprobante  arrastrar o, en el móvil, «Tomar foto» / galería / PDF
 *   ✓ Éxito        «En verificación» + qué notas se reactivan
 * Envía un pago agrupado (POST /payments/batches), que acepta desde 1 cuota.
 * Borrador: si se cierra sin enviar, al volver retoma donde quedó (salvo el archivo).
 */
const STEPS = ['Qué pagas', 'Cómo pagas', 'Datos', 'Comprobante'];
const METHOD_ICONS = { transfer: 'building', mobile_payment: 'phone', deposit: 'wallet', cash: 'receipt', card: 'card', other: 'info' };
const PROOF_ACCEPT = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'application/pdf': ['.pdf'] };
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const DRAFT_KEY = 'portal.payDraft';
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const readDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null;
  } catch {
    return null;
  }
};
const saveDraft = (d) => {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // sin almacenamiento: no hay borrador
  }
};

function PayWizard({ rows, students, colorOf, initialIds, onClose, onDone }) {
  const todayStr = localToday();
  const selectable = useMemo(() => rows.filter((p) => isDue(p) || isAdvance(p)), [rows]);
  const byId = useMemo(() => new Map(selectable.map((p) => [p.id, p])), [selectable]);

  // Borrador previo (si las cuotas siguen disponibles y no se pidió una selección concreta).
  const draft = useMemo(() => {
    const d = readDraft();
    if (!d || initialIds?.size) return null;
    const ids = (d.ids || []).filter((id) => byId.has(id));
    return ids.length ? { ...d, ids } : null;
  }, [byId, initialIds]);

  const [step, setStep] = useState(draft?.step && draft.step < 4 ? draft.step : 0);
  const [picked, setPicked] = useState(() => {
    const ids = draft?.ids || (initialIds?.size ? [...initialIds] : selectable.filter(isDue).map((p) => p.id));
    return new Map(ids.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)]));
  });
  const [form, setForm] = useState(() => ({
    method: draft?.method || 'transfer',
    reference: draft?.reference || '',
    paidOn: draft?.paidOn && draft.paidOn <= todayStr ? draft.paidOn : todayStr,
    note: draft?.note || '',
  }));
  const [currency, setCurrency] = useState(draft?.currency || null);
  const [proof, setProof] = useState(null);
  const [showAdvance, setShowAdvance] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [done, setDone] = useState(null); // lote enviado
  const restored = useRef(Boolean(draft));
  const cameraRef = useRef(null);

  const { data: rates } = useFetch(() => paymentsApi.currentRate(), []);
  const { data: accounts, loading: loadingAccounts } = useFetch(() => portalApi.getPaymentAccounts(), []);

  const selected = useMemo(() => [...picked.values()].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))), [picked]);
  const ids = useMemo(() => selected.map((p) => p.id), [selected]);
  const currencies = [...new Set(selected.map((p) => p.currency))];
  const lockedTo = currencies.length === 1 && currencies[0] !== 'USD' ? currencies[0] : null;
  const payCurrency = lockedTo || currency || rates?.default_currency || null;

  // Borrador: se guarda en cada cambio (sin el archivo).
  useEffect(() => {
    if (done) return;
    saveDraft({ ids, step, ...form, currency });
  }, [ids, step, form, currency, done]);

  // Cotización del total en la moneda y fecha elegidas.
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  useEffect(() => {
    if (!ids.length || !payCurrency || !form.paidOn || currencies.length > 1) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(() => {
      paymentsApi
        .batchQuote({ paymentIds: ids, currency: payCurrency, date: form.paidOn })
        .then((q) => !cancelled && setQuote(q))
        .catch(() => !cancelled && setQuote(null))
        .finally(() => !cancelled && setQuoting(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(','), payCurrency, form.paidOn]);

  const toggle = (p) => setPicked((cur) => toggleInOrder(cur, p, selectable).next);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const nameOf = (id) => students.find((s) => s.id === id)?.first_name || '';

  // Validación por paso: el botón «Continuar» solo se habilita si el paso está completo.
  const stepError = [
    !ids.length ? 'Elige al menos una cuota.' : currencies.length > 1 ? `Las cuotas elegidas están en monedas distintas (${currencies.join(', ')}): págalas por separado.` : null,
    !form.method ? 'Elige cómo pagaste.' : null,
    !form.paidOn ? 'Indica la fecha del pago.' : form.paidOn > todayStr ? 'La fecha no puede ser futura.' : !form.reference.trim() ? 'Escribe el número de referencia.' : null,
    !proof ? 'Adjunta el comprobante.' : null,
  ][step];

  // La cotización trae la moneda como objeto ({ code, symbol, decimals… }), no como código.
  const quoteCurrency = quote ? (typeof quote.currency === 'string' ? quote.currency : quote.currency?.code) : null;
  const totalLine = quote && quoteCurrency ? formatMoney(quote.amount, quoteCurrency) : formatAmounts(totalsOf(selected));
  const ref = refTotal(selected);

  const submit = async () => {
    setSending(true);
    setError(null);
    setFieldErrors({});
    try {
      const batch = await paymentsApi.createBatch(
        { paymentIds: ids, method: form.method, reference: form.reference.trim(), paidOn: form.paidOn, note: form.note.trim() || undefined, currency: payCurrency || undefined },
        proof
      );
      saveDraft(null);
      // ¿Qué hijos recuperan sus notas? Los que estaban en pausa y cubrieron TODAS sus vencidas.
      const unlocked = students.filter(
        (s) => s.grades_locked && rows.filter((p) => p.student_id === s.id && p.display_status === 'overdue').every((p) => picked.has(p.id))
      );
      setDone({ batch, unlocked });
      onDone?.();
    } catch (err) {
      setError(getErrorMessage(err));
      const fe = getFieldErrors(err);
      setFieldErrors(fe);
      if (fe.reference || fe.paidOn) setStep(2);
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    // Enviado: no queda borrador. Si no, se conserva para retomarlo.
    if (done) saveDraft(null);
    onClose();
  };

  // ---------------- Éxito ----------------
  if (done) {
    return (
      <Drawer title="¡Listo!" icon="checkCircle" onClose={close}>
        <div className="pw-success">
          <span className="pw-success__icon" aria-hidden="true">
            <Icon name="checkCircle" size={34} />
          </span>
          <h3 className="pw-success__title">Recibimos tu reporte de pago</h3>
          <p className="pw-success__text">
            {done.batch.item_count === 1 ? '1 cuota' : `${done.batch.item_count} cuotas`} por {formatMoney(done.batch.base_total, done.batch.base_currency)}. Administración lo
            verificará y te enviará {done.batch.item_count === 1 ? 'el recibo' : 'los recibos'}.
          </p>
          <ol className="pw-timeline" aria-label="Estado del pago">
            <li className="is-done">
              <span /> Reportado
            </li>
            <li className="is-current">
              <span /> En verificación
            </li>
            <li>
              <span /> Confirmado
            </li>
          </ol>
          {done.unlocked.length > 0 && (
            <div className="pw-unlocked">
              <Icon name="trendingUp" size={18} />
              <span>
                Las notas de <strong>{done.unlocked.map((s) => s.first_name).join(' y ')}</strong> ya se pueden ver de nuevo.
              </span>
            </div>
          )}
          <div className="pw-success__actions">
            <Button onClick={close}>Ver mis pagos</Button>
            <Link to="/" className="btn btn--secondary">
              Volver al inicio
            </Link>
          </div>
        </div>
      </Drawer>
    );
  }

  const dueList = selectable.filter(isDue);
  const advanceList = selectable.filter(isAdvance);
  const groupByChild = (list) => students.map((s) => ({ student: s, items: list.filter((p) => p.student_id === s.id) })).filter((g) => g.items.length);

  return (
    <Drawer
      title="Pagar"
      subtitle={`Paso ${step + 1} de ${STEPS.length} · ${STEPS[step]}`}
      icon="wallet"
      onClose={close}
      busy={sending}
      footer={
        <div className="pw-footer">
          <div className="pw-footer__total">
            <span>Total</span>
            <strong>{ids.length ? totalLine : '—'}</strong>
            {!quote && ref && ref.currency !== 'USD' && ids.length > 0 && <small>≈ {formatMoney(ref.amount, ref.currency)}</small>}
          </div>
          <div className="pw-footer__actions">
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={sending}>
                Atrás
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} disabled={Boolean(stepError)} title={stepError || undefined}>
                Continuar
              </Button>
            ) : (
              <Button icon="send" onClick={submit} loading={sending} loadingText="Enviando…" disabled={Boolean(stepError) || quoting}>
                Enviar reporte
              </Button>
            )}
          </div>
        </div>
      }
    >
      <ol className="pw-steps" aria-label="Pasos">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="pw-steps__dot">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
            <span className="pw-steps__label">{label}</span>
          </li>
        ))}
      </ol>

      {restored.current && step === 0 && (
        <Alert variant="info">Retomamos tu pago donde lo dejaste. Puedes cambiar lo que necesites.</Alert>
      )}
      <Alert>{error}</Alert>

      {/* ---------- 1. Qué pagas ---------- */}
      {step === 0 && (
        <div className="pw-what">
          {dueList.length === 0 && advanceList.length === 0 && <p className="home-muted">No tienes cuotas por pagar. ¡Estás al día!</p>}
          {groupByChild(dueList).map(({ student, items }) => (
            <PickGroup key={student.id} student={student} colorOf={colorOf} items={items} picked={picked} onToggle={toggle} />
          ))}
          {advanceList.length > 0 && (
            <div className="pw-advance">
              <button type="button" className="fh-link-btn" onClick={() => setShowAdvance((v) => !v)} aria-expanded={showAdvance}>
                <Icon name={showAdvance ? 'chevronUp' : 'chevronDown'} size={14} /> Adelantar meses ({advanceList.length} disponibles)
              </button>
              {showAdvance &&
                groupByChild(advanceList).map(({ student, items }) => (
                  <PickGroup key={student.id} student={student} colorOf={colorOf} items={items} picked={picked} onToggle={toggle} advance />
                ))}
            </div>
          )}
          {stepError && ids.length > 0 && <Alert variant="warning">{stepError}</Alert>}
        </div>
      )}

      {/* ---------- 2. Cómo pagas ---------- */}
      {step === 1 && (
        <div className="pw-how">
          <div className="pw-methods" role="radiogroup" aria-label="Método de pago">
            {Object.entries(REPORT_METHODS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={form.method === value}
                className={`pw-method ${form.method === value ? 'is-active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, method: value }))}
              >
                <Icon name={METHOD_ICONS[value] || 'wallet'} size={20} />
                {label}
              </button>
            ))}
          </div>
          <PaymentInstructions method={form.method} accounts={accounts} loading={loadingAccounts} />
          <Field label="Moneda en que pagas" hint={lockedTo ? `Estas cuotas son en ${lockedTo}: se pagan en esa moneda.` : 'Elige la moneda de tu transferencia o pago móvil.'}>
            <CurrencySelect value={payCurrency} onChange={setCurrency} status={rates} lockedTo={lockedTo} disabled={!rates} />
          </Field>
        </div>
      )}

      {/* ---------- 3. Datos ---------- */}
      {step === 2 && (
        <div className="pw-details">
          <div className="pw-amount" aria-live="polite">
            <span>Monto a pagar</span>
            <strong>{quoting ? 'Calculando…' : totalLine}</strong>
            <small>{REPORT_METHODS[form.method]} · calculado automáticamente, no necesitas escribirlo</small>
          </div>
          {quote && <ConversionBreakdown quote={{ ...quote, base_amount: quote.base_total }} compact />}
          <div className="form-grid">
            <Field label="Fecha del pago" error={fieldErrors.paidOn} required>
              <Input type="date" value={form.paidOn} max={todayStr} onChange={set('paidOn')} required />
            </Field>
            <Field label="Número de referencia" error={fieldErrors.reference} required hint={form.method === 'cash' ? 'El número del recibo que te entregaron.' : 'Está en el comprobante de tu banco.'}>
              <Input value={form.reference} onChange={set('reference')} maxLength={60} inputMode="numeric" placeholder="Ej. 000123456789" required autoFocus />
            </Field>
            <Field label="Nota (opcional)" error={fieldErrors.note} full>
              <Input value={form.note} onChange={set('note')} maxLength={300} placeholder="Banco de origen, titular de la cuenta…" />
            </Field>
          </div>
        </div>
      )}

      {/* ---------- 4. Comprobante ---------- */}
      {step === 3 && (
        <div className="pw-proof">
          <p className="pw-hint">Sube la captura o el PDF de la operación por el total. Es lo que administración revisa para confirmar.</p>
          {/* Móvil: abrir la cámara directamente. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > PROOF_MAX_BYTES) {
                setError('La foto pesa más de 5 MB. Prueba con una captura de pantalla del comprobante.');
                return;
              }
              setError(null);
              setProof(f);
            }}
          />
          <Button variant="secondary" icon="image" className="pw-camera" onClick={() => cameraRef.current?.click()}>
            Tomar foto del comprobante
          </Button>
          <FileDropzone
            value={proof}
            onChange={setProof}
            accept={PROOF_ACCEPT}
            maxBytes={PROOF_MAX_BYTES}
            label="Arrastra aquí la captura o el PDF"
            hint="JPG, PNG o PDF · máximo 5 MB"
            error={fieldErrors.proof}
            disabled={sending}
          />
          <div className="pw-review">
            <h4>Revisa antes de enviar</h4>
            <dl>
              <div>
                <dt>Cuotas</dt>
                <dd>{selected.map((p) => `${p.period_label} (${nameOf(p.student_id)})`).join(', ')}</dd>
              </div>
              <div>
                <dt>Monto</dt>
                <dd>{totalLine}</dd>
              </div>
              <div>
                <dt>Método</dt>
                <dd>{REPORT_METHODS[form.method]}</dd>
              </div>
              <div>
                <dt>Fecha y referencia</dt>
                <dd>
                  {formatDate(form.paidOn)} · {form.reference}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** Cuotas de un hijo con casillas grandes (filas táctiles). */
function PickGroup({ student, colorOf, items, picked, onToggle, advance = false }) {
  return (
    <section className="pw-group">
      <h4 className="pw-group__title">
        <ChildTag id={student.id} name={student.first_name} colorOf={colorOf} />
        {advance && <span className="text-sm text-muted">meses por adelantado</span>}
      </h4>
      <ul className="pw-items">
        {items.map((p) => {
          const st = statusOf(p);
          const checked = picked.has(p.id);
          return (
            <li key={p.id}>
              <label className={`pw-item ${checked ? 'is-checked' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(p)} />
                <span className="pw-item__main">
                  <span className="pw-item__title">{p.period_label}</span>
                  <span className={`pay-chip pay-chip--${st.tone}`}>{st.label}</span>
                </span>
                <strong className="pw-item__amount">{formatMoney(p.amount, p.currency)}</strong>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default PayWizard;
