import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { REPORT_METHODS, formatAmounts, formatDate, formatMoney } from '../paymentStatus';
import { ViewCurrencySelect } from '../currency';
import { useViewCurrency } from '../useViewCurrency';
import { useRateAutoRefresh } from '../useRateAutoRefresh';
import { refTotal, totalsOf } from '../components/StudentPaymentsSection';
import { isAdvance, isDue } from '../components/BatchPayment';
import { ProofButton, ProofViewerModal } from '../components/ProofViewer';
import ReceiptButton from '../components/ReceiptButton';
import { useFamily } from '../../portal/FamilyContext';
import { ChildTag, accountStatus, shortDate, statusOf } from './payStatus';
import PayWizard from './PayWizard';

/**
 * Pagos del portal de familia ("finanzas claras"):
 *   1. Resumen de cuenta   saldo, estado (chip suave), próximo vencimiento,
 *                          avance del año y una fila por hijo
 *   2. Lo que toca pagar   cuotas exigibles, cada una con «Pagar»; próximas plegadas
 *   3. En verificación     lo reportado que administración aún revisa
 *   4. Movimientos         pagos confirmados por mes, con recibo PDF de un toque
 * Todo pago pasa por el mismo flujo guiado (PayWizard). Enlaces directos:
 * ?pagar=vencidas (aviso de notas en pausa) · ?pagar=todo.
 */
function FamilyPaymentsPage() {
  const family = useFamily();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: rates, refetch: refetchRates } = useFetch(() => paymentsApi.currentRate(), []);
  const [viewCurrency, setViewCurrency] = useViewCurrency('myPayments.viewCurrency', rates);
  const { data: rows, loading, error, refetch } = useFetch(() => paymentsApi.listMine(viewCurrency ? { currency: viewCurrency } : undefined), [viewCurrency]);
  const { data: batches, refetch: refetchBatches } = useFetch(() => paymentsApi.myBatches(), []);
  const [paying, setPaying] = useState(null); // null | Set de ids preseleccionados (vacío = lo exigible)
  useRateAutoRefresh(rates, () => {
    refetchRates();
    refetch();
  });

  const all = rows || [];
  const students = family?.students || [];
  const colorOf = family?.colorOf;

  // Enlaces directos: abrir el pago con lo vencido o todo lo exigible ya marcado.
  useEffect(() => {
    const mode = params.get('pagar');
    if (!mode || !rows) return;
    const ids = all.filter((p) => (mode === 'vencidas' ? p.display_status === 'overdue' : isDue(p))).map((p) => p.id);
    setPaying(new Set(ids));
    const next = new URLSearchParams(params);
    next.delete('pagar');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const refreshAll = () => {
    refetch();
    refetchBatches();
    family?.refetch?.();
  };

  if (loading && !rows) {
    return (
      <div className="fp" aria-busy="true">
        <div className="skeleton fh-skeleton__title" />
        <div className="skeleton fp-skeleton__summary" />
      </div>
    );
  }

  const due = all.filter(isDue).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const upcoming = all.filter(isAdvance).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const paid = all.filter((p) => p.display_status === 'paid');
  const reportedSingles = all.filter((p) => p.display_status === 'reported' && !p.batch_id);
  const openPay = (ids) => setPaying(new Set(ids || []));

  return (
    <div className="fp">
      <header className="family-page-head">
        <div>
          <h1 className="family-page-head__title">Pagos</h1>
          <p className="family-page-head__sub">Mensualidades de tus representados. Cada mes vence en sus primeros 5 días.</p>
        </div>
        <ViewCurrencySelect value={viewCurrency} onChange={setViewCurrency} status={rates} />
      </header>
      <Alert>{error}</Alert>
      {(family?.data?.billing_issues || []).length > 0 && (
        <p className="fp-note">
          <Icon name="info" size={15} /> Algunas mensualidades aún no están cargadas en el sistema; tu saldo podría cambiar. Si tienes dudas, escríbele a administración.
        </p>
      )}

      <AccountSummary rows={all} due={due} upcoming={upcoming} students={students} colorOf={colorOf} onPay={openPay} />

      <DueList due={due} upcoming={upcoming} students={students} colorOf={colorOf} onPay={openPay} />

      <InReview batches={batches || []} singles={reportedSingles} students={students} colorOf={colorOf} onChanged={refreshAll} onPay={openPay} rows={all} toast={toast} />

      <Movements paid={paid} students={students} colorOf={colorOf} />

      {paying && (
        <PayWizard
          rows={all}
          students={students}
          colorOf={colorOf}
          initialIds={paying}
          onClose={() => setPaying(null)}
          onDone={refreshAll}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Resumen de cuenta
// ---------------------------------------------------------------------------

function AccountSummary({ rows, due, upcoming, students, colorOf, onPay }) {
  const status = accountStatus(rows.filter((p) => isDue(p) || p.display_status === 'reported'));
  const ref = refTotal(due);
  const next = [...due.filter((p) => p.display_status === 'pending'), ...upcoming].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
  const tuition = rows.filter((p) => p.kind === 'tuition' && !['cancelled', 'refunded', 'failed'].includes(p.display_status));
  const tuitionPaid = tuition.filter((p) => p.display_status === 'paid').length;
  const pct = tuition.length ? Math.round((tuitionPaid / tuition.length) * 100) : 0;

  return (
    <section className={`fp-summary fp-summary--${status.tone}`} aria-labelledby="fp-balance">
      <div className="fp-summary__top">
        <div>
          <span id="fp-balance" className="fp-summary__label">
            Saldo por pagar
          </span>
          <div className="fp-summary__amount">{due.length ? formatAmounts(totalsOf(due)) : formatMoney(0, 'USD')}</div>
          {ref && ref.currency !== 'USD' && due.length > 0 && <div className="fp-summary__ref">≈ {formatMoney(ref.amount, ref.currency)} a la tasa de hoy</div>}
        </div>
        <span className={`pay-chip pay-chip--${status.tone} pay-chip--lg`}>
          <span className="pay-chip__dot" aria-hidden="true" /> {status.label}
        </span>
      </div>

      <div className="fp-summary__facts">
        {next && (
          <div>
            <Icon name="calendar" size={16} /> Próximo vencimiento: <strong>{shortDate(next.due_date)}</strong> · {next.period_label}
          </div>
        )}
        {tuition.length > 0 && (
          <div className="fp-summary__progress">
            <div className="fp-summary__progress-head">
              <span>Mensualidades pagadas</span>
              <strong>
                {tuitionPaid} de {tuition.length}
              </strong>
            </div>
            <div className="learn-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Mensualidades pagadas">
              <div className="learn-progress__fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="fp-summary__actions">
        {due.length > 0 ? (
          <Button icon="wallet" onClick={() => onPay(due.filter((p) => p.display_status !== 'reported').map((p) => p.id))} disabled={!due.some((p) => p.display_status !== 'reported')}>
            Pagar ahora
          </Button>
        ) : (
          <span className="fp-summary__ok">
            <Icon name="checkCircle" size={18} /> ¡Estás al día! Gracias.
          </span>
        )}
        {upcoming.length > 0 && (
          <Button variant="ghost" onClick={() => onPay([])}>
            Adelantar meses
          </Button>
        )}
        <a href="#movimientos" className="fh-link-btn">
          Ver movimientos
        </a>
      </div>

      {students.length > 1 && (
        <ul className="fp-children">
          {students.map((s) => {
            const mine = rows.filter((p) => p.student_id === s.id);
            const st = accountStatus(mine.filter((p) => isDue(p) || p.display_status === 'reported'));
            const owed = mine.filter((p) => isDue(p) && p.display_status !== 'reported');
            return (
              <li key={s.id} className="fp-child">
                <ChildTag id={s.id} name={s.first_name} colorOf={colorOf} />
                <span className={`pay-chip pay-chip--${st.tone}`}>{st.label}</span>
                <span className="fp-child__amount">{owed.length ? formatAmounts(totalsOf(owed)) : ''}</span>
                {owed.length > 0 ? (
                  <Button size="sm" variant="secondary" onClick={() => onPay(owed.map((p) => p.id))}>
                    Pagar
                  </Button>
                ) : (
                  <Icon name="checkCircle" size={18} className="fp-child__ok" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Lo que toca pagar
// ---------------------------------------------------------------------------

function DueList({ due, upcoming, students, colorOf, onPay }) {
  const [showUpcoming, setShowUpcoming] = useState(false);
  const owed = due.filter((p) => p.display_status !== 'reported');
  const nameOf = (id) => students.find((s) => s.id === id)?.first_name;
  if (!owed.length && !upcoming.length) return null;
  return (
    <section className="fh-card fp-section" aria-labelledby="fp-due">
      <header className="fh-card__head">
        <h2 id="fp-due" className="fh-card__title">
          Lo que toca pagar
        </h2>
        {owed.length > 1 && (
          <button type="button" className="fh-link-btn" onClick={() => onPay(owed.map((p) => p.id))}>
            Pagar todo junto ({owed.length})
          </button>
        )}
      </header>
      {owed.length === 0 ? (
        <p className="home-muted">No hay cuotas por pagar en este momento.</p>
      ) : (
        <ul className="fp-list">
          {owed.map((p) => (
            <PaymentRow key={p.id} p={p} name={nameOf(p.student_id)} colorOf={colorOf} action={<Button size="sm" onClick={() => onPay([p.id])}>Pagar</Button>} />
          ))}
        </ul>
      )}
      {upcoming.length > 0 && (
        <>
          <button type="button" className="fh-link-btn fp-toggle" onClick={() => setShowUpcoming((v) => !v)} aria-expanded={showUpcoming}>
            <Icon name={showUpcoming ? 'chevronUp' : 'chevronDown'} size={14} /> Próximas mensualidades ({upcoming.length})
          </button>
          {showUpcoming && (
            <ul className="fp-list fp-list--muted">
              {upcoming.map((p) => (
                <PaymentRow key={p.id} p={p} name={nameOf(p.student_id)} colorOf={colorOf} action={<Button size="sm" variant="ghost" onClick={() => onPay([p.id])}>Adelantar</Button>} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Fila de una cuota: concepto, hijo, estado (chip suave) y monto con su equivalente. */
function PaymentRow({ p, name, colorOf, action, meta }) {
  const st = statusOf(p);
  return (
    <li className="fp-row">
      <div className="fp-row__main">
        <span className="fp-row__title">{p.period_label}</span>
        <span className="fp-row__meta">
          <ChildTag id={p.student_id} name={name || p.student_first_name} colorOf={colorOf} />
          {meta || <span className={`pay-chip pay-chip--${st.tone}`}>{st.label}</span>}
        </span>
      </div>
      <div className="fp-row__amount">
        <strong>{formatMoney(p.amount, p.currency)}</strong>
        {p.conv_amount !== null && p.conv_amount !== undefined && p.conv_currency && p.conv_currency !== p.currency && <small>≈ {formatMoney(p.conv_amount, p.conv_currency)}</small>}
      </div>
      {action && <div className="fp-row__action">{action}</div>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 3. En verificación
// ---------------------------------------------------------------------------

function InReview({ batches, singles, rows, students, colorOf, onChanged, onPay, toast }) {
  const confirm = useConfirm();
  const [viewing, setViewing] = useState(null);
  const reviewing = batches.filter((b) => b.status === 'reported');
  // Rechazados de los últimos 45 días: el motivo y la salida a la vista.
  const rejected = batches.filter((b) => b.status === 'rejected' && Date.now() - new Date(b.reviewed_at || b.reported_at) < 45 * 86_400_000);
  if (!reviewing.length && !rejected.length && !singles.length) return null;

  const withdraw = async (b) => {
    const ok = await confirm({
      title: '¿Retirar este reporte?',
      message: `${b.item_count === 1 ? 'La cuota vuelve' : `Las ${b.item_count} cuotas vuelven`} a «por pagar» para que corrijas y reportes de nuevo.`,
      confirmLabel: 'Retirar',
      icon: 'refresh',
    });
    if (!ok) return;
    try {
      await paymentsApi.withdrawBatch(b.id);
      toast.success('Reporte retirado', 'Puedes corregirlo y enviarlo de nuevo.');
      onChanged();
    } catch (err) {
      toast.error('No se pudo retirar', getErrorMessage(err));
    }
  };

  const itemsLabel = (b) => b.items.map((i) => `${i.period_label} (${i.student_name.split(' ')[0]})`).join(', ');

  return (
    <section className="fh-card fp-section" aria-labelledby="fp-review">
      <header className="fh-card__head">
        <h2 id="fp-review" className="fh-card__title">
          En verificación
        </h2>
      </header>
      <ul className="fp-review">
        {reviewing.map((b) => (
          <li key={b.id} className="fp-review__item">
            <div className="fp-review__main">
              <strong>{formatMoney(b.base_total, b.base_currency)}</strong>
              <span className="fp-row__meta">{itemsLabel(b)}</span>
              <span className="fp-row__meta">
                {REPORT_METHODS[b.method]} · ref. {b.reference} · reportado el {formatDate(b.reported_at)}
              </span>
              <ol className="pw-timeline pw-timeline--sm" aria-label="Estado">
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
            </div>
            <div className="fp-review__actions">
              {b.has_proof && (
                <Button size="sm" variant="ghost" icon="paperclip" onClick={() => setViewing(b)}>
                  Comprobante
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => withdraw(b)}>
                Retirar
              </Button>
            </div>
          </li>
        ))}
        {singles.map((p) => (
          <PaymentRow
            key={p.id}
            p={p}
            name={students.find((s) => s.id === p.student_id)?.first_name}
            colorOf={colorOf}
            meta={<span className="pay-chip pay-chip--info">En verificación · reportado el {formatDate(p.reported_at)}</span>}
          />
        ))}
        {rejected.map((b) => {
          const stillDue = b.items.map((i) => i.payment_id || i.id).filter((id) => rows.some((p) => p.id === id && isDue(p) && p.display_status !== 'reported'));
          return (
            <li key={b.id} className="fp-review__item fp-review__item--rejected">
              <div className="fp-review__main">
                <strong>No pudimos confirmar este pago</strong>
                <span className="fp-row__meta">
                  {formatMoney(b.base_total, b.base_currency)} · {itemsLabel(b)}
                </span>
                {b.rejection_reason && (
                  <span className="fp-review__reason">
                    <Icon name="info" size={14} /> {b.rejection_reason}
                  </span>
                )}
              </div>
              {stillDue.length > 0 && (
                <div className="fp-review__actions">
                  <Button size="sm" onClick={() => onPay(stillDue)}>
                    Reportar de nuevo
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {viewing && (
        <ProofViewerModal
          payment={{ id: viewing.id, proof_mime: viewing.proof_mime, proof_original_name: viewing.proof_original_name, period_label: `Pago de ${viewing.item_count} cuota(s)`, proof_uploaded_at: viewing.proof_uploaded_at }}
          load={() => paymentsApi.getBatchProofBlob(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Movimientos
// ---------------------------------------------------------------------------

const MONTH = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });

function Movements({ paid, students, colorOf }) {
  const [child, setChild] = useState('');
  const groups = useMemo(() => {
    const list = paid.filter((p) => !child || p.student_id === child).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
    const map = new Map();
    list.forEach((p) => {
      const key = String(p.paid_at || p.due_date).slice(0, 7);
      map.set(key, [...(map.get(key) || []), p]);
    });
    return [...map.entries()];
  }, [paid, child]);
  const nameOf = (id) => students.find((s) => s.id === id)?.first_name;

  return (
    <section id="movimientos" className="fh-card fp-section" aria-labelledby="fp-moves">
      <header className="fh-card__head">
        <h2 id="fp-moves" className="fh-card__title">
          Movimientos
        </h2>
      </header>
      {students.length > 1 && paid.length > 0 && (
        <div className="agenda-filters" role="group" aria-label="Filtrar por hijo">
          <button type="button" className={`agenda-filter ${!child ? 'is-active' : ''}`} onClick={() => setChild('')} aria-pressed={!child}>
            Todos
          </button>
          {students.map((s) => (
            <button key={s.id} type="button" className={`agenda-filter ${child === s.id ? 'is-active' : ''}`} onClick={() => setChild(child === s.id ? '' : s.id)} aria-pressed={child === s.id}>
              {s.first_name}
            </button>
          ))}
        </div>
      )}
      {groups.length === 0 ? (
        <p className="home-muted">Aquí verás tus pagos confirmados con su recibo.</p>
      ) : (
        groups.map(([month, list]) => {
          const label = MONTH.format(new Date(`${month}-15T12:00:00`));
          return (
            <div key={month} className="fp-month">
              <h3 className="fp-month__title">{label.charAt(0).toUpperCase() + label.slice(1)}</h3>
              <ul className="fp-list">
                {list.map((p) => (
                  <PaymentRow
                    key={p.id}
                    p={p}
                    name={nameOf(p.student_id)}
                    colorOf={colorOf}
                    meta={
                      <span className="pay-chip pay-chip--ok">
                        Pagado el {formatDate(p.paid_at, false)}
                        {p.payment_method || p.report_method ? ` · ${REPORT_METHODS[p.payment_method || p.report_method] || ''}` : ''}
                      </span>
                    }
                    action={
                      <div className="fp-row__docs">
                        {p.receipt_url && <ReceiptButton paymentId={p.id} label="Recibo PDF" className="btn btn--secondary btn--sm" />}
                        {p.proof_path && <ProofButton payment={p} label="Comprobante" variant="ghost" />}
                      </div>
                    }
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

export default FamilyPaymentsPage;
