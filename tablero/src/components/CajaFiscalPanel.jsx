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

const groupedControlStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '0.9rem',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  fontSize: '0.84rem',
  color: palette.muted,
  fontWeight: 600,
};

const inputStyle = {
  border: `1px solid ${palette.line}`,
  borderRadius: '12px',
  padding: '0.8rem 0.9rem',
  fontSize: '0.95rem',
  color: palette.ink,
  backgroundColor: '#fff',
  outline: 'none',
};

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
      byYear.set(year, {
        year,
        payroll: 0,
        months: new Map(),
      });
    }

    const item = byYear.get(year);
    const gasto = Number(row.monto_total_gastado || 0);
    const links = Number(row.cantidad_funcionarios_unicos || 0);
    item.payroll += gasto;

    if (!item.months.has(month)) {
      item.months.set(month, { links: 0 });
    }
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
      return {
        year: item.year,
        payroll: item.payroll,
        avgLinks,
        avgAnnualSalary,
      };
    });

  if (annual.length === 0) {
    const fallback = [];
    let payroll = 9.2e12;
    let links = 285000;
    for (let year = 2015; year <= 2025; year += 1) {
      fallback.push({
        year,
        payroll,
        avgLinks: links,
        avgAnnualSalary: payroll / links,
      });
      payroll *= 1.075;
      links *= 1.011;
    }
    return fallback;
  }

  return annual;
};

const simulateScenario = ({
  annualBase,
  contributionRate,
  replacementRate,
  retirementAge,
  inflation,
  realWageGrowth,
  activeGrowth,
  density,
  pensionIndexation,
  mortality,
  initialDependency,
  reserve0,
  horizonYear,
  reformYear = 2026,
}) => {
  const lastObserved = annualBase[annualBase.length - 1];
  const projectionYears = [];
  for (let year = lastObserved.year + 1; year <= horizonYear; year += 1) {
    projectionYears.push(year);
  }

  const effectiveRetirementRate = clamp(0.056 - (retirementAge - 60) * 0.0042, 0.018, 0.065);
  const effectiveDensity = clamp(density, 0.65, 1.05);
  const priceGrowth = 1 + inflation;
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
      year: row.year,
      activeLinks: row.avgLinks,
      wageBill: row.payroll,
      averageWage: row.avgAnnualSalary,
      pensioners,
      averagePension: avgPension,
      income,
      expense,
      balance: income - expense,
      reserve,
      dependency: pensioners / Math.max(row.avgLinks, 1),
      pressure: expense / Math.max(income, 1),
      projected: false,
    };
  });

  let currentActiveLinks = lastObserved.avgLinks;
  let currentAverageWage = lastObserved.avgAnnualSalary;

  const projectedSeries = projectionYears.map((year) => {
    currentActiveLinks *= activeGrowthFactor;
    currentAverageWage *= wageGrowth;

    const wageBill = currentActiveLinks * currentAverageWage;
    const newRetirees = prevPensioners * 0 + (currentActiveLinks / activeGrowthFactor) * effectiveRetirementRate;
    const pensioners = prevPensioners * (1 - mortality) + newRetirees;
    const avgPension = ((prevPensioners * (1 - mortality) * prevAvgPension * pensionIndexFactor) + (newRetirees * currentAverageWage * replacementRate)) / Math.max(pensioners, 1);

    const income = wageBill * contributionRate * effectiveDensity;
    const expense = pensioners * avgPension;
    reserve += income - expense;

    prevPensioners = pensioners;
    prevAvgPension = avgPension;

    return {
      year,
      activeLinks: currentActiveLinks,
      wageBill,
      averageWage: currentAverageWage,
      pensioners,
      averagePension: avgPension,
      income,
      expense,
      balance: income - expense,
      reserve,
      dependency: pensioners / Math.max(currentActiveLinks, 1),
      pressure: expense / Math.max(income, 1),
      projected: true,
      reformYear,
    };
  });

  return [...historicalSeries, ...projectedSeries];
};

const presentValue = (series, discountRate, fromYear) => {
  return series
    .filter((d) => d.year >= fromYear)
    .reduce((acc, row) => acc + (row.balance / Math.pow(1 + discountRate, row.year - fromYear)), 0);
};

const firstNegativeReserveYear = (series) => {
  const row = series.find((d) => d.reserve < 0);
  return row ? row.year : null;
};

const firstPressureAboveOne = (series) => {
  const row = series.find((d) => d.year >= 2026 && d.pressure > 1);
  return row ? row.year : null;
};

const oneWayDriver = (params, annualBase, pick) => {
  const scenario = simulateScenario({ ...params, ...pick, annualBase });
  return scenario[scenario.length - 1].balance;
};

const CajaFiscalPanel = ({ globalData = [] }) => {
  const annualBase = useMemo(() => buildAnnualBase(globalData), [globalData]);

  const [horizonYear, setHorizonYear] = useState(2045);
  const [inflation, setInflation] = useState(0.04);
  const [realWageGrowth, setRealWageGrowth] = useState(0.015);
  const [activeGrowth, setActiveGrowth] = useState(0.012);
  const [densityCurrent, setDensityCurrent] = useState(0.92);
  const [densityReform, setDensityReform] = useState(0.95);
  const [mortality, setMortality] = useState(0.05);
  const [initialDependency, setInitialDependency] = useState(0.36);
  const [reserve0, setReserve0] = useState(0);
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

  const currentParams = {
    contributionRate: contributionCurrent,
    replacementRate: replacementCurrent,
    retirementAge: retAgeCurrent,
    inflation,
    realWageGrowth,
    activeGrowth,
    density: densityCurrent,
    pensionIndexation: indexationCurrent,
    mortality,
    initialDependency,
    reserve0,
    horizonYear,
    reformYear,
  };

  const reformParams = {
    contributionRate: contributionReform,
    replacementRate: replacementReform,
    retirementAge: retAgeReform,
    inflation,
    realWageGrowth,
    activeGrowth,
    density: densityReform,
    pensionIndexation: indexationReform,
    mortality,
    initialDependency,
    reserve0,
    horizonYear,
    reformYear,
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
    const deficitBase2045 = lastBaseline.balance;
    const deficitRef2045 = lastReform.balance;
    const onlyContribution = oneWayDriver({ ...currentParams, contributionRate: contributionReform }, annualBase, { density: densityCurrent });
    const onlyRetAge = oneWayDriver({ ...currentParams, retirementAge: retAgeReform }, annualBase, {});
    const onlyReplacement = oneWayDriver({ ...currentParams, replacementRate: replacementReform, pensionIndexation: indexationReform }, annualBase, {});
    const onlyDensity = oneWayDriver({ ...currentParams, density: densityReform }, annualBase, {});

    return [
      { label: 'Mayor tasa de aporte', improvement: onlyContribution - deficitBase2045 },
      { label: 'Aplazamiento de retiro', improvement: onlyRetAge - deficitBase2045 },
      { label: 'Menor reemplazo e indexación', improvement: onlyReplacement - deficitBase2045 },
      { label: 'Mejor densidad contributiva', improvement: onlyDensity - deficitBase2045 },
      { label: 'Efecto conjunto', improvement: deficitRef2045 - deficitBase2045 },
    ];
  }, [annualBase, currentParams, contributionReform, retAgeReform, replacementReform, indexationReform, densityReform, densityCurrent, lastBaseline.balance, lastReform.balance]);

  const labels = baselineSeries.map((d) => String(d.year));
  const projectedIndex = baselineSeries.findIndex((d) => d.year === 2026);

  const historicalIncome = baselineSeries.map((d) => (d.year <= 2025 ? d.income : null));
  const historicalExpense = baselineSeries.map((d) => (d.year <= 2025 ? d.expense : null));
  const projectedIncomeBase = baselineSeries.map((d) => (d.year >= 2026 ? d.income : null));
  const projectedExpenseBase = baselineSeries.map((d) => (d.year >= 2026 ? d.expense : null));
  const projectedIncomeReform = reformSeries.map((d) => (d.year >= 2026 ? d.income : null));
  const projectedExpenseReform = reformSeries.map((d) => (d.year >= 2026 ? d.expense : null));

  const lineData = {
    labels,
    datasets: [
      {
        label: 'Ingresos observados / calibrados',
        data: historicalIncome,
        borderColor: palette.secondary,
        backgroundColor: palette.secondary,
        tension: 0.25,
        borderWidth: 3,
        pointRadius: 0,
      },
      {
        label: 'Egresos observados / calibrados',
        data: historicalExpense,
        borderColor: palette.rose,
        backgroundColor: palette.rose,
        tension: 0.25,
        borderWidth: 3,
        pointRadius: 0,
      },
      {
        label: 'Ingresos proyectados, sin cambios legales',
        data: projectedIncomeBase,
        borderColor: '#2563eb',
        backgroundColor: '#2563eb',
        borderDash: [8, 6],
        tension: 0.25,
        borderWidth: 3,
        pointRadius: 0,
      },
      {
        label: 'Egresos proyectados, sin cambios legales',
        data: projectedExpenseBase,
        borderColor: '#dc2626',
        backgroundColor: '#dc2626',
        borderDash: [8, 6],
        tension: 0.25,
        borderWidth: 3,
        pointRadius: 0,
      },
      {
        label: 'Ingresos proyectados, con reforma',
        data: projectedIncomeReform,
        borderColor: palette.primary,
        backgroundColor: palette.primary,
        tension: 0.25,
        borderWidth: 3,
        pointRadius: 0,
      },
      {
        label: 'Egresos proyectados, con reforma',
        data: projectedExpenseReform,
        borderColor: palette.amber,
        backgroundColor: palette.amber,
        tension: 0.25,
        borderWidth: 3,
        pointRadius: 0,
      },
    ],
  };

  const balanceData = {
    labels: projectionBase.map((d) => String(d.year)),
    datasets: [
      {
        type: 'bar',
        label: 'Balance anual, sin cambios legales',
        data: projectionBase.map((d) => d.balance),
        backgroundColor: 'rgba(220, 38, 38, 0.22)',
        borderColor: '#dc2626',
        borderWidth: 1,
      },
      {
        type: 'line',
        label: 'Balance anual, con reforma',
        data: projectionReform.map((d) => d.balance),
        borderColor: palette.primary,
        backgroundColor: palette.primary,
        borderWidth: 3,
        pointRadius: 0,
        tension: 0.2,
      },
    ],
  };

  const reserveData = {
    labels,
    datasets: [
      {
        label: 'Reserva acumulada, sin cambios legales',
        data: baselineSeries.map((d) => d.reserve),
        borderColor: '#7f1d1d',
        backgroundColor: 'rgba(127, 29, 29, 0.10)',
        fill: true,
        tension: 0.2,
        borderWidth: 2.5,
        pointRadius: 0,
      },
      {
        label: 'Reserva acumulada, con reforma',
        data: reformSeries.map((d) => d.reserve),
        borderColor: palette.green,
        backgroundColor: 'rgba(22, 101, 52, 0.10)',
        fill: true,
        tension: 0.2,
        borderWidth: 2.5,
        pointRadius: 0,
      },
    ],
  };

  const driverData = {
    labels: driverBreakdown.map((d) => d.label),
    datasets: [
      {
        label: 'Mejora del balance en el año final del horizonte',
        data: driverBreakdown.map((d) => d.improvement),
        backgroundColor: driverBreakdown.map((d) => (d.improvement >= 0 ? 'rgba(22, 163, 74, 0.70)' : 'rgba(220, 38, 38, 0.70)')),
        borderColor: driverBreakdown.map((d) => (d.improvement >= 0 ? '#15803d' : '#b91c1c')),
        borderWidth: 1,
      },
    ],
  };

  const narrative = useMemo(() => {
    const improvementPV = pvReform - pvBase;
    const pressureFinalGap = lastBaseline.pressure - lastReform.pressure;
    const messages = [];

    if (lastBaseline.pressure > 1) {
      messages.push(`En el escenario sin cambios legales, por cada ₲1 que ingresa al régimen en ${horizonYear}, el modelo proyecta ₲${lastBaseline.pressure.toFixed(2)} de egresos.`);
    } else {
      messages.push(`En el escenario base, el sistema todavía se mantiene por debajo de una relación gasto/ingreso de 1 al cierre del horizonte.`);
    }

    if (lastReform.pressure < lastBaseline.pressure) {
      messages.push(`La reforma reduce la presión previsional en ${formatPct(pressureFinalGap, 1)} puntos relativos al cierre del horizonte, principalmente por el triple efecto de mayor aporte, retiro más tardío y menor generosidad promedio de la prestación.`);
    }

    if (improvementPV > 0) {
      messages.push(`El valor presente del flujo financiero mejora en aproximadamente ${formatMoney(improvementPV)} entre 2026 y ${horizonYear}. Esto no significa que desaparezca automáticamente el déficit, pero sí que la trayectoria se vuelve bastante menos explosiva.`);
    }

    const depRatioDelta = lastReform.dependency - lastHistorical.dependency;
    messages.push(`La relación pensionados sobre cotizantes pasa de ${formatPct(lastHistorical.dependency, 1)} en el último año calibrado a ${formatPct(lastReform.dependency, 1)} bajo reforma. Aun cuando el parámetro legal mejore, el envejecimiento sigue empujando el gasto.`);

    return messages;
  }, [pvBase, pvReform, lastBaseline.pressure, lastReform.pressure, horizonYear, lastHistorical.dependency, lastReform.dependency]);

  const mainLineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          boxWidth: 14,
          usePointStyle: true,
          pointStyle: 'line',
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`,
        },
      },
      annotation: undefined,
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          callback: (value, idx) => (idx === projectedIndex ? '2026 · proyección' : labels[idx]),
          maxRotation: 0,
          autoSkip: true,
        },
      },
      y: {
        ticks: {
          callback: (value) => formatCompact(value),
        },
        title: {
          display: true,
          text: 'Guaraníes anuales',
        },
      },
    },
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        ticks: { callback: (value) => formatCompact(value) },
        title: { display: true, text: 'Balance anual' },
      },
    },
  };

  const reserveOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        ticks: { callback: (value) => formatCompact(value) },
        title: { display: true, text: 'Reserva acumulada' },
      },
    },
  };

  const scenarioTableRows = [
    {
      metric: 'Ingresos del último año del horizonte',
      base: lastBaseline.income,
      reform: lastReform.income,
    },
    {
      metric: 'Egresos del último año del horizonte',
      base: lastBaseline.expense,
      reform: lastReform.expense,
    },
    {
      metric: 'Balance del último año del horizonte',
      base: lastBaseline.balance,
      reform: lastReform.balance,
    },
    {
      metric: 'Relación gasto/ingreso',
      base: lastBaseline.pressure,
      reform: lastReform.pressure,
      isRatio: true,
    },
    {
      metric: 'Dependencia pensionados/cotizantes',
      base: lastBaseline.dependency,
      reform: lastReform.dependency,
      isRatio: true,
    },
    {
      metric: 'Valor presente 2026-horizonte',
      base: pvBase,
      reform: pvReform,
    },
  ];

  return (
    <div className="dashboard-container" style={{ paddingTop: '0.5rem' }}>
      <section style={{ ...sectionCardStyle, padding: '1.7rem 1.7rem 1.4rem', marginBottom: '1.4rem', background: 'linear-gradient(135deg, #f8fffe 0%, #f8fafc 60%, #eef2ff 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '780px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', background: palette.primarySoft, color: palette.primary, padding: '0.45rem 0.8rem', borderRadius: '999px', fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.9rem' }}>
              Simulador actuarial agregado, calibrado sobre la masa salarial histórica del tablero
            </div>
            <h2 style={{ margin: 0, color: palette.ink, fontSize: '2rem', lineHeight: 1.1 }}>Escenarios globales de sostenibilidad de la Caja Fiscal</h2>
            <p style={{ color: palette.muted, fontSize: '1rem', lineHeight: 1.65, marginTop: '0.9rem', marginBottom: 0 }}>
              Este módulo transforma el panel en una herramienta de decisión. Toma la serie histórica de masa salarial y vínculos contributivos observada en el tablero, calibra un stock de pensionados y proyecta ingresos, egresos, balances y reservas bajo dos trayectorias, continuidad normativa y reforma paramétrica. El objetivo no es reemplazar una valuación oficial con microdatos completos, sino mostrar con claridad cómo se mueve el sistema cuando cambian los incentivos centrales.
            </p>
          </div>
          <div style={{ minWidth: '250px', maxWidth: '320px', background: '#fff', border: `1px solid ${palette.line}`, borderRadius: '18px', padding: '1rem 1.05rem' }}>
            <div style={{ color: palette.muted, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Lectura rápida</div>
            <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.7rem' }}>
              <div>
                <div style={{ fontSize: '0.82rem', color: palette.muted }}>Último año histórico calibrado</div>
                <div style={{ fontWeight: 800, color: palette.ink }}>{lastHistorical.year}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.82rem', color: palette.muted }}>Presión gasto/ingreso actual</div>
                <div style={{ fontWeight: 800, color: lastHistorical.pressure > 1 ? palette.red : palette.green }}>{lastHistorical.pressure.toFixed(2)}x</div>
              </div>
              <div>
                <div style={{ fontSize: '0.82rem', color: palette.muted }}>Hito de reforma modelado</div>
                <div style={{ fontWeight: 800, color: palette.ink }}>{reformYear}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ ...sectionCardStyle, marginBottom: '1.4rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: '1rem' }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: '0.9rem', color: palette.ink }}>Supuestos comunes de la proyección</h3>
            <div style={groupedControlStyle}>
              <label style={labelStyle}>Año final del horizonte
                <input type="number" min="2030" max="2060" value={horizonYear} onChange={(e) => setHorizonYear(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Año de entrada en vigor
                <input type="number" min="2026" max="2040" value={reformYear} onChange={(e) => setReformYear(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Inflación anual esperada
                <input type="number" step="0.005" value={inflation} onChange={(e) => setInflation(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Crecimiento real salarial
                <input type="number" step="0.005" value={realWageGrowth} onChange={(e) => setRealWageGrowth(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Crecimiento de cotizantes
                <input type="number" step="0.005" value={activeGrowth} onChange={(e) => setActiveGrowth(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Mortalidad anual de pensionados
                <input type="number" step="0.005" value={mortality} onChange={(e) => setMortality(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Dependencia inicial pensionados/cotizantes
                <input type="number" step="0.01" value={initialDependency} onChange={(e) => setInitialDependency(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Reserva inicial del fondo
                <input type="number" step="1000000000" value={reserve0} onChange={(e) => setReserve0(Number(e.target.value))} style={inputStyle} />
              </label>
              <label style={labelStyle}>Tasa de descuento para valor presente
                <input type="number" step="0.005" value={discountRate} onChange={(e) => setDiscountRate(Number(e.target.value))} style={inputStyle} />
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ border: `1px solid ${palette.line}`, borderRadius: '18px', padding: '1rem', background: '#fff' }}>
              <h4 style={{ marginTop: 0, color: palette.ink }}>Escenario sin cambios legales</h4>
              <div style={groupedControlStyle}>
                <label style={labelStyle}>Tasa de aporte
                  <input type="number" step="0.005" value={contributionCurrent} onChange={(e) => setContributionCurrent(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Edad normal de retiro
                  <input type="number" step="1" value={retAgeCurrent} onChange={(e) => setRetAgeCurrent(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Tasa de sustitución
                  <input type="number" step="0.01" value={replacementCurrent} onChange={(e) => setReplacementCurrent(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Indexación de pensiones
                  <input type="number" step="0.05" value={indexationCurrent} onChange={(e) => setIndexationCurrent(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Densidad contributiva
                  <input type="number" step="0.01" value={densityCurrent} onChange={(e) => setDensityCurrent(Number(e.target.value))} style={inputStyle} />
                </label>
              </div>
            </div>

            <div style={{ border: `1px solid ${palette.line}`, borderRadius: '18px', padding: '1rem', background: '#f0fdfa' }}>
              <h4 style={{ marginTop: 0, color: palette.ink }}>Escenario con reforma</h4>
              <div style={groupedControlStyle}>
                <label style={labelStyle}>Tasa de aporte
                  <input type="number" step="0.005" value={contributionReform} onChange={(e) => setContributionReform(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Edad normal de retiro
                  <input type="number" step="1" value={retAgeReform} onChange={(e) => setRetAgeReform(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Tasa de sustitución
                  <input type="number" step="0.01" value={replacementReform} onChange={(e) => setReplacementReform(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Indexación de pensiones
                  <input type="number" step="0.05" value={indexationReform} onChange={(e) => setIndexationReform(Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={labelStyle}>Densidad contributiva
                  <input type="number" step="0.01" value={densityReform} onChange={(e) => setDensityReform(Number(e.target.value))} style={inputStyle} />
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: '1.4rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div className="kpi-card" style={{ alignItems: 'flex-start', textAlign: 'left', overflow: 'hidden' }}>
          <span className="kpi-title">Balance anual al cierre del horizonte, sin reforma</span>
          <span className="kpi-value" style={{ color: lastBaseline.balance >= 0 ? palette.green : palette.red, fontSize: '1.35rem', wordBreak: 'break-word', lineHeight: 1.2 }}>{formatCompact(lastBaseline.balance)} Gs.</span>
          <div style={{ color: palette.muted, fontSize: '0.88rem', marginTop: '0.55rem' }}>Presión final {lastBaseline.pressure.toFixed(2)}x</div>
        </div>
        <div className="kpi-card" style={{ alignItems: 'flex-start', textAlign: 'left', overflow: 'hidden' }}>
          <span className="kpi-title">Balance anual al cierre del horizonte, con reforma</span>
          <span className="kpi-value" style={{ color: lastReform.balance >= 0 ? palette.green : palette.red, fontSize: '1.35rem', wordBreak: 'break-word', lineHeight: 1.2 }}>{formatCompact(lastReform.balance)} Gs.</span>
          <div style={{ color: palette.muted, fontSize: '0.88rem', marginTop: '0.55rem' }}>Presión final {lastReform.pressure.toFixed(2)}x</div>
        </div>
        <div className="kpi-card" style={{ alignItems: 'flex-start', textAlign: 'left', overflow: 'hidden' }}>
          <span className="kpi-title">Reserva agotada, sin reforma</span>
          <span className="kpi-value" style={{ fontSize: '1.8rem', color: depletionBase ? palette.red : palette.green }}>{depletionBase || 'No se agota'}</span>
          <div style={{ color: palette.muted, fontSize: '0.88rem', marginTop: '0.55rem' }}>Cruce gasto/ingreso &gt; 1: {pressureBaseYear || 'No ocurre'}</div>
        </div>
        <div className="kpi-card" style={{ alignItems: 'flex-start', textAlign: 'left', overflow: 'hidden' }}>
          <span className="kpi-title">Reserva agotada, con reforma</span>
          <span className="kpi-value" style={{ fontSize: '1.8rem', color: depletionReform ? palette.amber : palette.green }}>{depletionReform || 'No se agota'}</span>
          <div style={{ color: palette.muted, fontSize: '0.88rem', marginTop: '0.55rem' }}>Cruce gasto/ingreso &gt; 1: {pressureReformYear || 'No ocurre'}</div>
        </div>
      </section>

      <div className="chart-container" style={{ height: '420px', marginBottom: '1.4rem' }}>
        <h3 className="chart-title">Trayectoria histórica y proyectada de ingresos y egresos</h3>
        <p style={{ color: palette.muted, marginTop: '-0.6rem', marginBottom: '1rem' }}>
          Las líneas continuas muestran la parte histórica calibrada. A partir de 2026, la comparación pasa a ser plenamente contrafactual. Así se ve de inmediato si el gasto previsional converge, se estabiliza o sigue desbordando a los ingresos contributivos.
        </p>
        <Line data={lineData} options={mainLineOptions} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.2rem', marginBottom: '1.4rem', minHeight: 0 }}>
        <div className="chart-container" style={{ marginBottom: 0, minHeight: 0 }}>
          <h3 className="chart-title">Balance anual proyectado</h3>
          <p style={{ color: palette.muted, marginTop: '-0.6rem', marginBottom: '1rem' }}>
            Las barras muestran la inercia financiera sin cambios legales. La línea verde representa el mismo sistema bajo reforma. Cuando la línea sigue debajo de cero, la reforma mejora, pero todavía no resuelve completamente el problema estructural.
          </p>
          <div style={{ position: 'relative', height: '320px' }}>
            <Bar data={balanceData} options={barOptions} />
          </div>
        </div>

        <div className="chart-container" style={{ marginBottom: 0, minHeight: 0 }}>
          <h3 className="chart-title">Reserva acumulada o necesidad de financiamiento</h3>
          <p style={{ color: palette.muted, marginTop: '-0.6rem', marginBottom: '1rem' }}>
            Este gráfico traduce el flujo anual a una narrativa más intuitiva. Cuando la curva cae por debajo de cero, el régimen ya requiere financiamiento fiscal explícito o endeudamiento para sostener las prestaciones.
          </p>
          <div style={{ position: 'relative', height: '320px' }}>
            <Line data={reserveData} options={reserveOptions} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: '1.2rem', marginBottom: '1.4rem' }}>
        <section style={sectionCardStyle}>
          <h3 style={{ marginTop: 0, color: palette.ink }}>Comparación sintética de escenarios</h3>
          <div className="table-wrapper" style={{ marginTop: '0.8rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th style={{ textAlign: 'right' }}>Sin reforma</th>
                  <th style={{ textAlign: 'right' }}>Con reforma</th>
                  <th style={{ textAlign: 'right' }}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {scenarioTableRows.map((row) => {
                  const diff = row.reform - row.base;
                  return (
                    <tr key={row.metric}>
                      <td><strong>{row.metric}</strong></td>
                      <td style={{ textAlign: 'right' }}>{row.isRatio ? `${row.base.toFixed(2)}x` : formatMoney(row.base)}</td>
                      <td style={{ textAlign: 'right' }}>{row.isRatio ? `${row.reform.toFixed(2)}x` : formatMoney(row.reform)}</td>
                      <td style={{ textAlign: 'right', color: diff >= 0 ? palette.green : palette.red, fontWeight: 700 }}>
                        {row.isRatio ? `${diff.toFixed(2)}x` : formatMoney(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section style={sectionCardStyle}>
          <h3 style={{ marginTop: 0, color: palette.ink }}>Qué está moviendo realmente la mejora</h3>
          <p style={{ color: palette.muted, marginTop: '-0.2rem', marginBottom: '1rem' }}>
            Esta descomposición no es una atribución causal perfecta, pero sí una lectura útil para decisiones. Permite ver qué palancas están aportando más alivio al balance final del sistema.
          </p>
          <div style={{ height: '300px' }}>
            <Bar data={driverData} options={barOptions} />
          </div>
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem' }}>
        <section style={sectionCardStyle}>
          <h3 style={{ marginTop: 0, color: palette.ink }}>Lectura actuarial en lenguaje claro</h3>
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            {narrative.map((text) => (
              <div key={text} style={{ borderLeft: `4px solid ${palette.primary}`, paddingLeft: '0.9rem', color: palette.ink, lineHeight: 1.65 }}>
                {text}
              </div>
            ))}
          </div>
        </section>

        <section style={sectionCardStyle}>
          <h3 style={{ marginTop: 0, color: palette.ink }}>Notas metodológicas</h3>
          <div style={{ color: palette.ink, lineHeight: 1.7, fontSize: '0.95rem' }}>
            <p style={{ marginTop: 0 }}>
              1. La calibración histórica usa la masa salarial observada en el tablero como aproximación a la base imponible del régimen. Por eso la lectura central es sobre tendencias y órdenes de magnitud, no sobre una contabilidad cerrada de caja.
            </p>
            <p>
              2. El número de pensionados surge de una ecuación de stock y flujo, pensionados del año anterior menos mortalidad más nuevas jubilaciones, donde la tasa de retiro responde a la edad normal de acceso. Esto permite que el parámetro legal afecte no solo el beneficio promedio, sino también el calendario de entrada al pasivo.
            </p>
            <p>
              3. Los ingresos dependen de la masa salarial, la tasa de aporte y la densidad contributiva. Los egresos dependen del número de pensionados, la tasa de sustitución y la regla de indexación. Es decir, el modelo hace explícita la diferencia entre recaudar más y prometer menos, que son mecanismos con implicancias distributivas distintas.
            </p>
            <p style={{ marginBottom: 0 }}>
              4. Si luego se incorporan microdatos de cotizantes, pensionados, pensión media por cohorte y flujo real de transferencias del Tesoro, este motor puede convertirse en una valuación actuarial mucho más cercana a una proyección oficial.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default CajaFiscalPanel;
