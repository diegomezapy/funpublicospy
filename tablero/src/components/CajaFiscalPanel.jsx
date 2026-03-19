import React, { useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Title,
  Tooltip,
  Legend,
);

const formatMoney = (val) => new Intl.NumberFormat('es-PY', {
  style: 'currency',
  currency: 'PYG',
  maximumFractionDigits: 0,
}).format(Number.isFinite(val) ? val : 0);

const formatCompact = (val) => new Intl.NumberFormat('es-PY', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
}).format(Number.isFinite(val) ? val : 0);

const formatPct = (val, digits = 1) => `${((Number.isFinite(val) ? val : 0) * 100).toFixed(digits)}%`;

const palette = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#cbd5e1',
  panel: '#ffffff',
  soft: '#f8fafc',
  primary: '#0f766e',
  primarySoft: 'rgba(15, 118, 110, 0.12)',
  secondary: '#1d4ed8',
  amber: '#d97706',
  rose: '#be123c',
  red: '#b91c1c',
  green: '#166534',
};

const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

const sectionCardStyle = {
  background: palette.panel,
  border: `1px solid ${palette.line}`,
  borderRadius: '22px',
  padding: '1.35rem',
  boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)',
};

const buildAnnualBase = (globalData = []) => {
  const byYear = new Map();

  (globalData || []).forEach((row) => {
    const year = Number(row.anio);
    const month = Number(row.mes);
    if (!Number.isFinite(year) || !Number.isFinite(month) || year > 2025) return;

    if (!byYear.has(year)) {
      byYear.set(year, { year, payroll: 0, months: new Map() });
    }

    const item = byYear.get(year);
    const gasto = Number(row.monto_total_gastado || 0);
    const links = Number(row.cantidad_funcionarios_unicos || 0);
    item.payroll += gasto;

    if (!item.months.has(month)) item.months.set(month, { links: 0 });
    item.months.get(month).links += links;
  });

  const annual = Array.from(byYear.values())
    .sort((a, b) => a.year - b.year)
    .map((item) => {
      const monthRows = Array.from(item.months.values());
      const avgLinks = monthRows.length > 0
        ? monthRows.reduce((acc, m) => acc + m.links, 0) / monthRows.length
        : 0;
      const avgAnnualSalary = avgLinks > 0 ? item.payroll / avgLinks : 0;
      return { year: item.year, payroll: item.payroll, avgLinks, avgAnnualSalary };
    });

  if (annual.length === 0) {
    const fallback = [];
    let payroll = 9.2e12;
    let links = 285000;
    for (let year = 2015; year <= 2025; year += 1) {
      fallback.push({ year, payroll, avgLinks: links, avgAnnualSalary: payroll / links });
      payroll *= 1.075;
      links *= 1.011;
    }
    return fallback;
  }

  return annual;
};

const simulateScenario = ({
  annualBase, contributionRate, replacementRate, retirementAge,
  inflation, realWageGrowth, activeGrowth, density, pensionIndexation,
  mortality, initialDependency, reserve0, horizonYear, reformYear = 2026,
}) => {
  const lastObserved = annualBase[annualBase.length - 1];
  const projectionYears = [];
  for (let year = lastObserved.year + 1; year <= horizonYear; year += 1) projectionYears.push(year);

  const effectiveRetirementRate = clamp(0.056 - (retirementAge - 60) * 0.0042, 0.018, 0.065);
  const effectiveDensity = clamp(density, 0.65, 1.05);
  const wageGrowth = 1 + inflation + realWageGrowth;
  const activeGrowthFactor = 1 + activeGrowth;
  const pensionIndexFactor = 1 + inflation * pensionIndexation;

  let prevPensioners = lastObserved.avgLinks * initialDependency;
  let prevAvgPension = lastObserved.avgAnnualSalary * replacementRate;
  let reserve = reserve0;

  const historicalSeries = annualBase.map((row, idx) => {
    const pensioners = idx === 0
      ? row.avgLinks * initialDependency
      : prevPensioners * (1 - mortality) + annualBase[idx - 1].avgLinks * effectiveRetirementRate;

    const avgPension = idx === 0
      ? row.avgAnnualSalary * replacementRate
      : ((prevPensioners * (1 - mortality) * prevAvgPension * pensionIndexFactor) + (annualBase[idx - 1].avgLinks * effectiveRetirementRate * row.avgAnnualSalary * replacementRate)) / Math.max(pensioners, 1);

    const income = row.payroll * contributionRate * effectiveDensity;
    const expense = pensioners * avgPension;
    reserve += income - expense;
    prevPensioners = pensioners;
    prevAvgPension = avgPension;

    return {
      year: row.year, activeLinks: row.avgLinks, wageBill: row.payroll,
      averageWage: row.avgAnnualSalary, pensioners, averagePension: avgPension,
      income, expense, balance: income - expense, reserve,
      dependency: pensioners / Math.max(row.avgLinks, 1),
      pressure: expense / Math.max(income, 1), projected: false,
    };
  });

  let currentActiveLinks = lastObserved.avgLinks;
  let currentAverageWage = lastObserved.avgAnnualSalary;

  const projectedSeries = projectionYears.map((year) => {
    currentActiveLinks *= activeGrowthFactor;
    currentAverageWage *= wageGrowth;
    const wageBill = currentActiveLinks * currentAverageWage;
    const newRetirees = (currentActiveLinks / activeGrowthFactor) * effectiveRetirementRate;
    const pensioners = prevPensioners * (1 - mortality) + newRetirees;
    const avgPension = ((prevPensioners * (1 - mortality) * prevAvgPension * pensionIndexFactor) + (newRetirees * currentAverageWage * replacementRate)) / Math.max(pensioners, 1);
    const income = wageBill * contributionRate * effectiveDensity;
    const expense = pensioners * avgPension;
    reserve += income - expense;
    prevPensioners = pensioners;
    prevAvgPension = avgPension;

    return {
      year, activeLinks: currentActiveLinks, wageBill, averageWage: currentAverageWage,
      pensioners, averagePension: avgPension, income, expense,
      balance: income - expense, reserve,
      dependency: pensioners / Math.max(currentActiveLinks, 1),
      pressure: expense / Math.max(income, 1), projected: true, reformYear,
    };
  });

  return [...historicalSeries, ...projectedSeries];
};

const presentValue = (series, discountRate, fromYear) =>
  series.filter((d) => d.year >= fromYear)
    .reduce((acc, row) => acc + (row.balance / Math.pow(1 + discountRate, row.year - fromYear)), 0);

const firstNegativeReserveYear = (series) => { const row = series.find((d) => d.reserve < 0); return row ? row.year : null; };
const firstPressureAboveOne = (series) => { const row = series.find((d) => d.year >= 2026 && d.pressure > 1); return row ? row.year : null; };
const oneWayDriver = (params, annualBase, pick) => { const s = simulateScenario({ ...params, ...pick, annualBase }); return s[s.length - 1].balance; };

/* ============================================================ */
const CajaFiscalPanel = ({ globalData = [] }) => {
  const annualBase = useMemo(() => buildAnnualBase(globalData), [globalData]);

  const [horizonYear, setHorizonYear] = useState(2045);
  const [inflation, setInflation] = useState(0.04);
  const [realWageGrowth, setRealWageGrowth] = useState(0.015);
  const [activeGrowth, setActiveGrowth] = useState(0.012);
  const [mortality, setMortality] = useState(0.05);
  const [initialDependency, setInitialDependency] = useState(0.36);
  const [reserve0] = useState(0);
  const [discountRate, setDiscountRate] = useState(0.06);
  const [reformYear, setReformYear] = useState(2027);

  const [contributionCurrent, setContributionCurrent] = useState(0.16);
  const [contributionReform, setContributionReform] = useState(0.19);
  const [retAgeCurrent, setRetAgeCurrent] = useState(62);
  const [retAgeReform, setRetAgeReform] = useState(65);
  const [replacementCurrent, setReplacementCurrent] = useState(0.93);
  const [replacementReform, setReplacementReform] = useState(0.78);
  const [indexationCurrent, setIndexationCurrent] = useState(1.0);
  const [indexationReform, setIndexationReform] = useState(0.8);
  const [densityCurrent, setDensityCurrent] = useState(0.92);
  const [densityReform, setDensityReform] = useState(0.95);

  const currentParams = {
    contributionRate: contributionCurrent, replacementRate: replacementCurrent,
    retirementAge: retAgeCurrent, inflation, realWageGrowth, activeGrowth,
    density: densityCurrent, pensionIndexation: indexationCurrent,
    mortality, initialDependency, reserve0, horizonYear, reformYear,
  };
  const reformParams = {
    contributionRate: contributionReform, replacementRate: replacementReform,
    retirementAge: retAgeReform, inflation, realWageGrowth, activeGrowth,
    density: densityReform, pensionIndexation: indexationReform,
    mortality, initialDependency, reserve0, horizonYear, reformYear,
  };

  const baselineSeries = useMemo(
    () => simulateScenario({ annualBase, ...currentParams }),
    [annualBase, contributionCurrent, replacementCurrent, retAgeCurrent, inflation, realWageGrowth, activeGrowth, densityCurrent, indexationCurrent, mortality, initialDependency, reserve0, horizonYear, reformYear],
  );
  const reformSeries = useMemo(
    () => simulateScenario({ annualBase, ...reformParams }),
    [annualBase, contributionReform, replacementReform, retAgeReform, inflation, realWageGrowth, activeGrowth, densityReform, indexationReform, mortality, initialDependency, reserve0, horizonYear, reformYear],
  );

  const projectionBase = baselineSeries.filter((d) => d.year >= 2026);
  const projectionReform = reformSeries.filter((d) => d.year >= 2026);
  const lastHistorical = baselineSeries.filter((d) => !d.projected).slice(-1)[0];
  const lastBaseline = baselineSeries[baselineSeries.length - 1];
  const lastReform = reformSeries[reformSeries.length - 1];

  const pvBase = presentValue(projectionBase, discountRate, 2026);
  const pvReform = presentValue(projectionReform, discountRate, 2026);
  const depletionBase = firstNegativeReserveYear(baselineSeries);
  const depletionReform = firstNegativeReserveYear(reformSeries);
  const pressureBaseYear = firstPressureAboveOne(baselineSeries);
  const pressureReformYear = firstPressureAboveOne(reformSeries);

  const driverBreakdown = useMemo(() => {
    const deficitBase = lastBaseline.balance;
    const deficitRef = lastReform.balance;
    return [
      { label: 'Mayor tasa de aporte', improvement: oneWayDriver({ ...currentParams, contributionRate: contributionReform }, annualBase, { density: densityCurrent }) - deficitBase },
      { label: 'Aplazamiento de retiro', improvement: oneWayDriver({ ...currentParams, retirementAge: retAgeReform }, annualBase, {}) - deficitBase },
      { label: 'Menor reemplazo/indexación', improvement: oneWayDriver({ ...currentParams, replacementRate: replacementReform, pensionIndexation: indexationReform }, annualBase, {}) - deficitBase },
      { label: 'Mejor densidad', improvement: oneWayDriver({ ...currentParams, density: densityReform }, annualBase, {}) - deficitBase },
      { label: 'Efecto conjunto', improvement: deficitRef - deficitBase },
    ];
  }, [annualBase, contributionReform, retAgeReform, replacementReform, indexationReform, densityReform, densityCurrent, lastBaseline.balance, lastReform.balance]);

  const labels = baselineSeries.map((d) => String(d.year));
  const projectedIndex = baselineSeries.findIndex((d) => d.year === 2026);

  const lineData = {
    labels,
    datasets: [
      { label: 'Ingresos hist.', data: baselineSeries.map((d) => (d.year <= 2025 ? d.income : null)), borderColor: palette.secondary, backgroundColor: palette.secondary, tension: 0.25, borderWidth: 3, pointRadius: 0 },
      { label: 'Egresos hist.', data: baselineSeries.map((d) => (d.year <= 2025 ? d.expense : null)), borderColor: palette.rose, backgroundColor: palette.rose, tension: 0.25, borderWidth: 3, pointRadius: 0 },
      { label: 'Ingresos proy. sin reforma', data: baselineSeries.map((d) => (d.year >= 2026 ? d.income : null)), borderColor: '#2563eb', backgroundColor: '#2563eb', borderDash: [8, 6], tension: 0.25, borderWidth: 2.5, pointRadius: 0 },
      { label: 'Egresos proy. sin reforma', data: baselineSeries.map((d) => (d.year >= 2026 ? d.expense : null)), borderColor: '#dc2626', backgroundColor: '#dc2626', borderDash: [8, 6], tension: 0.25, borderWidth: 2.5, pointRadius: 0 },
      { label: 'Ingresos proy. con reforma', data: reformSeries.map((d) => (d.year >= 2026 ? d.income : null)), borderColor: palette.primary, backgroundColor: palette.primary, tension: 0.25, borderWidth: 2.5, pointRadius: 0 },
      { label: 'Egresos proy. con reforma', data: reformSeries.map((d) => (d.year >= 2026 ? d.expense : null)), borderColor: palette.amber, backgroundColor: palette.amber, tension: 0.25, borderWidth: 2.5, pointRadius: 0 },
    ],
  };

  const balanceData = {
    labels: projectionBase.map((d) => String(d.year)),
    datasets: [
      { type: 'bar', label: 'Balance sin reforma', data: projectionBase.map((d) => d.balance), backgroundColor: 'rgba(220,38,38,0.22)', borderColor: '#dc2626', borderWidth: 1 },
      { type: 'line', label: 'Balance con reforma', data: projectionReform.map((d) => d.balance), borderColor: palette.primary, backgroundColor: palette.primary, borderWidth: 3, pointRadius: 0, tension: 0.2 },
    ],
  };

  const reserveData = {
    labels,
    datasets: [
      { label: 'Reserva sin reforma', data: baselineSeries.map((d) => d.reserve), borderColor: '#7f1d1d', backgroundColor: 'rgba(127,29,29,0.10)', fill: true, tension: 0.2, borderWidth: 2.5, pointRadius: 0 },
      { label: 'Reserva con reforma', data: reformSeries.map((d) => d.reserve), borderColor: palette.green, backgroundColor: 'rgba(22,101,52,0.10)', fill: true, tension: 0.2, borderWidth: 2.5, pointRadius: 0 },
    ],
  };

  const driverData = {
    labels: driverBreakdown.map((d) => d.label),
    datasets: [{
      label: 'Mejora del balance',
      data: driverBreakdown.map((d) => d.improvement),
      backgroundColor: driverBreakdown.map((d) => (d.improvement >= 0 ? 'rgba(22,163,74,0.70)' : 'rgba(220,38,38,0.70)')),
      borderColor: driverBreakdown.map((d) => (d.improvement >= 0 ? '#15803d' : '#b91c1c')),
      borderWidth: 1,
    }],
  };

  const narrative = useMemo(() => {
    const msgs = [];
    if (lastBaseline.pressure > 1) {
      msgs.push(`Sin cambios legales, por cada ₲1 que ingresa en ${horizonYear}, el modelo proyecta ₲${lastBaseline.pressure.toFixed(2)} de egresos.`);
    } else {
      msgs.push(`En el escenario base, el sistema se mantiene con relación gasto/ingreso menor a 1 al cierre del horizonte.`);
    }
    if (lastReform.pressure < lastBaseline.pressure) {
      msgs.push(`La reforma reduce la presión en ${formatPct(lastBaseline.pressure - lastReform.pressure, 1)} puntos, por el triple efecto de mayor aporte, retiro más tardío y menor generosidad de la prestación.`);
    }
    if (pvReform - pvBase > 0) {
      msgs.push(`El valor presente del flujo mejora en aprox. ${formatMoney(pvReform - pvBase)} entre 2026 y ${horizonYear}.`);
    }
    msgs.push(`La relación pensionados/cotizantes pasa de ${formatPct(lastHistorical.dependency, 1)} (último año calibrado) a ${formatPct(lastReform.dependency, 1)} bajo reforma. El envejecimiento sigue presionando el gasto.`);
    return msgs;
  }, [pvBase, pvReform, lastBaseline.pressure, lastReform.pressure, horizonYear, lastHistorical.dependency, lastReform.dependency]);

  const chartOpts = (titleY) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, pointStyle: 'line', padding: 12 } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, callback: (v, i) => (i === projectedIndex ? '2026·proy.' : labels[i]) } },
      y: { ticks: { callback: (v) => formatCompact(v) }, title: { display: !!titleY, text: titleY || '' } },
    },
  });

  const scenarioTableRows = [
    { metric: 'Ingresos último año', base: lastBaseline.income, reform: lastReform.income },
    { metric: 'Egresos último año', base: lastBaseline.expense, reform: lastReform.expense },
    { metric: 'Balance último año', base: lastBaseline.balance, reform: lastReform.balance },
    { metric: 'Presión gasto/ingreso', base: lastBaseline.pressure, reform: lastReform.pressure, isRatio: true },
    { metric: 'Dependencia pensionados/cotizantes', base: lastBaseline.dependency, reform: lastReform.dependency, isRatio: true },
    { metric: 'VPN flujo 2026-horizonte', base: pvBase, reform: pvReform },
  ];

  /* ---- Estilos del sidebar ---- */
  const sliderRow = { display: 'flex', flexDirection: 'column', gap: '1px', marginBottom: '0.85rem' };
  const sliderLabel = (color) => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: '0.72rem', fontWeight: 700, color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.04em',
  });
  const sliderVal = (color) => ({ fontWeight: 800, fontSize: '0.85rem', color: color || palette.primary });
  const range = (color) => ({ width: '100%', accentColor: color || palette.primary, cursor: 'pointer', marginTop: '2px' });
  const groupTag = (label, color) => (
    <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: color, background: `${color}18`, borderRadius: '5px', padding: '3px 7px', margin: '0.7rem 0 0.4rem' }}>
      {label}
    </div>
  );
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  const pct1 = (v) => `${(v * 100).toFixed(1)}%`;

  /* ---- Card de gráfico ---- */
  const chartCard = (children, extraStyle = {}) => (
    <div style={{ background: 'var(--card-bg)', backdropFilter: 'blur(16px)', padding: '1.3rem 1.5rem', borderRadius: '22px', border: '1px solid rgba(255,255,255,0.4)', boxShadow: 'var(--shadow-glass)', overflow: 'hidden', ...extraStyle }}>
      {children}
    </div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', minHeight: '100vh' }}>

      {/* ===== SIDEBAR DE CONTROLES ===== */}
      <aside style={{
        width: '258px', minWidth: '258px', flexShrink: 0,
        background: '#f1f5f9',
        borderRight: `1px solid ${palette.line}`,
        padding: '1rem 0.95rem 2rem',
        position: 'sticky', top: 0,
        height: '100vh', overflowY: 'auto', overflowX: 'hidden',
        boxSizing: 'border-box', zIndex: 10,
      }}>
        <div style={{ fontWeight: 800, fontSize: '0.8rem', color: palette.ink, marginBottom: '0.2rem' }}>⚙ Parámetros</div>
        <div style={{ fontSize: '0.7rem', color: palette.muted, marginBottom: '0.5rem', lineHeight: 1.4 }}>Mueve las barras y los gráficos se actualizan al instante.</div>

        {groupTag('⚙ Comunes', '#334155')}

        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Horizonte</span><span style={sliderVal()}>{horizonYear}</span></div>
          <input type="range" min="2030" max="2060" step="1" value={horizonYear} onChange={(e) => setHorizonYear(Number(e.target.value))} style={range()} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Año de reforma</span><span style={sliderVal()}>{reformYear}</span></div>
          <input type="range" min="2026" max="2040" step="1" value={reformYear} onChange={(e) => setReformYear(Number(e.target.value))} style={range()} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Inflación anual</span><span style={sliderVal()}>{pct(inflation)}</span></div>
          <input type="range" min="0.01" max="0.15" step="0.005" value={inflation} onChange={(e) => setInflation(Number(e.target.value))} style={range()} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Crec. real salarios</span><span style={sliderVal()}>{pct(realWageGrowth)}</span></div>
          <input type="range" min="0" max="0.05" step="0.005" value={realWageGrowth} onChange={(e) => setRealWageGrowth(Number(e.target.value))} style={range()} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Crec. cotizantes</span><span style={sliderVal()}>{pct(activeGrowth)}</span></div>
          <input type="range" min="-0.01" max="0.04" step="0.005" value={activeGrowth} onChange={(e) => setActiveGrowth(Number(e.target.value))} style={range()} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Mortalidad pensionados</span><span style={sliderVal()}>{pct(mortality)}</span></div>
          <input type="range" min="0.01" max="0.12" step="0.005" value={mortality} onChange={(e) => setMortality(Number(e.target.value))} style={range()} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Dependencia inicial</span><span style={sliderVal()}>{pct1(initialDependency)}</span></div>
          <input type="range" min="0.1" max="0.8" step="0.01" value={initialDependency} onChange={(e) => setInitialDependency(Number(e.target.value))} style={range()} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Tasa descuento VPN</span><span style={sliderVal()}>{pct(discountRate)}</span></div>
          <input type="range" min="0.02" max="0.12" step="0.005" value={discountRate} onChange={(e) => setDiscountRate(Number(e.target.value))} style={range()} />
        </div>

        {groupTag('🔵 Sin reforma', '#1d4ed8')}

        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Tasa de aporte</span><span style={sliderVal('#1d4ed8')}>{pct(contributionCurrent)}</span></div>
          <input type="range" min="0.05" max="0.30" step="0.005" value={contributionCurrent} onChange={(e) => setContributionCurrent(Number(e.target.value))} style={range('#1d4ed8')} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Edad de retiro</span><span style={sliderVal('#1d4ed8')}>{retAgeCurrent} años</span></div>
          <input type="range" min="55" max="70" step="1" value={retAgeCurrent} onChange={(e) => setRetAgeCurrent(Number(e.target.value))} style={range('#1d4ed8')} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Tasa sustitución</span><span style={sliderVal('#1d4ed8')}>{pct(replacementCurrent)}</span></div>
          <input type="range" min="0.40" max="1.00" step="0.01" value={replacementCurrent} onChange={(e) => setReplacementCurrent(Number(e.target.value))} style={range('#1d4ed8')} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Indexación pensiones</span><span style={sliderVal('#1d4ed8')}>{pct1(indexationCurrent)}</span></div>
          <input type="range" min="0.5" max="1.2" step="0.05" value={indexationCurrent} onChange={(e) => setIndexationCurrent(Number(e.target.value))} style={range('#1d4ed8')} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Densidad contributiva</span><span style={sliderVal('#1d4ed8')}>{pct1(densityCurrent)}</span></div>
          <input type="range" min="0.5" max="1.0" step="0.01" value={densityCurrent} onChange={(e) => setDensityCurrent(Number(e.target.value))} style={range('#1d4ed8')} />
        </div>

        {groupTag('🟢 Con reforma', palette.primary)}

        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Tasa de aporte</span><span style={sliderVal(palette.primary)}>{pct(contributionReform)}</span></div>
          <input type="range" min="0.05" max="0.35" step="0.005" value={contributionReform} onChange={(e) => setContributionReform(Number(e.target.value))} style={range(palette.primary)} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Edad de retiro</span><span style={sliderVal(palette.primary)}>{retAgeReform} años</span></div>
          <input type="range" min="55" max="70" step="1" value={retAgeReform} onChange={(e) => setRetAgeReform(Number(e.target.value))} style={range(palette.primary)} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Tasa sustitución</span><span style={sliderVal(palette.primary)}>{pct(replacementReform)}</span></div>
          <input type="range" min="0.40" max="1.00" step="0.01" value={replacementReform} onChange={(e) => setReplacementReform(Number(e.target.value))} style={range(palette.primary)} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Indexación pensiones</span><span style={sliderVal(palette.primary)}>{pct1(indexationReform)}</span></div>
          <input type="range" min="0.5" max="1.2" step="0.05" value={indexationReform} onChange={(e) => setIndexationReform(Number(e.target.value))} style={range(palette.primary)} />
        </div>
        <div style={sliderRow}>
          <div style={sliderLabel()}><span>Densidad contributiva</span><span style={sliderVal(palette.primary)}>{pct1(densityReform)}</span></div>
          <input type="range" min="0.5" max="1.0" step="0.01" value={densityReform} onChange={(e) => setDensityReform(Number(e.target.value))} style={range(palette.primary)} />
        </div>
      </aside>

      {/* ===== ÁREA PRINCIPAL ===== */}
      <div style={{ flex: 1, minWidth: 0, padding: '1rem 1.2rem', boxSizing: 'border-box' }}>

        {/* Header compacto */}
        <section style={{ ...sectionCardStyle, padding: '1.1rem 1.4rem', marginBottom: '1rem', background: 'linear-gradient(135deg,#f8fffe 0%,#f8fafc 60%,#eef2ff 100%)' }}>
          <h2 style={{ margin: '0 0 0.5rem', color: palette.ink, fontSize: '1.4rem', lineHeight: 1.1 }}>Escenarios de Sostenibilidad · Caja Fiscal</h2>
          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
            {[
              ['Último año calibrado', lastHistorical.year, palette.ink],
              ['Presión actual', `${lastHistorical.pressure.toFixed(2)}x`, lastHistorical.pressure > 1 ? palette.red : palette.green],
              ['Año reforma', reformYear, palette.ink],
              ['Horizonte', horizonYear, palette.ink],
            ].map(([k, v, c]) => (
              <div key={k}><div style={{ fontSize: '0.72rem', color: palette.muted }}>{k}</div><strong style={{ color: c }}>{v}</strong></div>
            ))}
          </div>
        </section>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
          {[
            { title: 'Balance final sin reforma', value: `${formatCompact(lastBaseline.balance)} Gs.`, sub: `Presión ${lastBaseline.pressure.toFixed(2)}x`, color: lastBaseline.balance >= 0 ? palette.green : palette.red },
            { title: 'Balance final con reforma', value: `${formatCompact(lastReform.balance)} Gs.`, sub: `Presión ${lastReform.pressure.toFixed(2)}x`, color: lastReform.balance >= 0 ? palette.green : palette.red },
            { title: 'Reserva agotada sin reforma', value: depletionBase || '✓', sub: `Cruce >1: ${pressureBaseYear || 'No ocurre'}`, color: depletionBase ? palette.red : palette.green },
            { title: 'Reserva agotada con reforma', value: depletionReform || '✓', sub: `Cruce >1: ${pressureReformYear || 'No ocurre'}`, color: depletionReform ? palette.amber : palette.green },
          ].map((k) => (
            <div key={k.title} className="kpi-card" style={{ alignItems: 'flex-start', overflow: 'hidden', padding: '0.9rem' }}>
              <span className="kpi-title">{k.title}</span>
              <span className="kpi-value" style={{ color: k.color, fontSize: '1.15rem', wordBreak: 'break-word', lineHeight: 1.2 }}>{k.value}</span>
              <div style={{ color: palette.muted, fontSize: '0.78rem', marginTop: '0.25rem' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Gráfico 1: Trayectoria completa */}
        {chartCard(<>
          <h3 className="chart-title" style={{ fontSize: '1rem' }}>Trayectoria histórica y proyectada de ingresos y egresos</h3>
          <div style={{ position: 'relative', height: '280px', overflow: 'hidden' }}>
            <Line data={lineData} options={chartOpts('Gs. anuales')} />
          </div>
        </>, { marginBottom: '1rem' })}

        {/* Gráficos 2 + 3 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', minHeight: 0 }}>
          {chartCard(<>
            <h3 className="chart-title" style={{ fontSize: '0.95rem' }}>Balance anual proyectado</h3>
            <div style={{ position: 'relative', height: '240px', overflow: 'hidden' }}>
              <Bar data={balanceData} options={chartOpts('Balance')} />
            </div>
          </>, { minWidth: 0 })}
          {chartCard(<>
            <h3 className="chart-title" style={{ fontSize: '0.95rem' }}>Reserva acumulada</h3>
            <div style={{ position: 'relative', height: '240px', overflow: 'hidden' }}>
              <Line data={reserveData} options={chartOpts('Reserva')} />
            </div>
          </>, { minWidth: 0 })}
        </div>

        {/* Composición + Tabla */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '1rem', marginBottom: '1rem', minHeight: 0 }}>
          {chartCard(<>
            <h3 className="chart-title" style={{ fontSize: '0.95rem' }}>Palancas de mejora</h3>
            <div style={{ position: 'relative', height: '230px', overflow: 'hidden' }}>
              <Bar data={driverData} options={chartOpts()} />
            </div>
          </>, { minWidth: 0 })}
          <div style={{ ...sectionCardStyle, overflow: 'hidden', minWidth: 0 }}>
            <h3 style={{ marginTop: 0, color: palette.ink, fontSize: '0.95rem' }}>Comparación sintética</h3>
            <div className="table-wrapper" style={{ maxHeight: '260px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Indicador</th>
                    <th style={{ textAlign: 'right' }}>Sin reforma</th>
                    <th style={{ textAlign: 'right' }}>Con reforma</th>
                    <th style={{ textAlign: 'right' }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioTableRows.map((row) => {
                    const diff = row.reform - row.base;
                    return (
                      <tr key={row.metric}>
                        <td style={{ fontSize: '0.85rem' }}>{row.metric}</td>
                        <td style={{ textAlign: 'right', fontSize: '0.85rem' }}>{row.isRatio ? `${row.base.toFixed(2)}x` : formatMoney(row.base)}</td>
                        <td style={{ textAlign: 'right', fontSize: '0.85rem' }}>{row.isRatio ? `${row.reform.toFixed(2)}x` : formatMoney(row.reform)}</td>
                        <td style={{ textAlign: 'right', color: diff >= 0 ? palette.green : palette.red, fontWeight: 700, fontSize: '0.85rem' }}>{row.isRatio ? `${diff.toFixed(2)}x` : formatCompact(diff)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Narrativa */}
        <section style={sectionCardStyle}>
          <h3 style={{ marginTop: 0, color: palette.ink, fontSize: '0.95rem' }}>Lectura actuarial en lenguaje claro</h3>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {narrative.map((text) => (
              <div key={text} style={{ borderLeft: `4px solid ${palette.primary}`, paddingLeft: '0.9rem', color: palette.ink, lineHeight: 1.65, fontSize: '0.88rem' }}>
                {text}
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
};

export default CajaFiscalPanel;
