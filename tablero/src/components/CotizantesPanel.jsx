import React, { useEffect, useState, useMemo } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const fmt = (v) => new Intl.NumberFormat('es-PY', { notation: 'compact', maximumFractionDigits: 1 }).format(v ?? 0);
const fmtN = (v) => new Intl.NumberFormat('es-PY').format(Math.round(v ?? 0));

const PALETTE = [
  '#0f766e','#1d4ed8','#7c3aed','#be123c','#d97706',
  '#0e7490','#15803d','#9a3412','#6b21a8','#0369a1',
];

const GRUPO_LABELS = {
  'Administración Pública': 'Adm. Pública',
  'Fuerzas Armadas y Policiales': 'FF.AA. y Policía',
  'Fuerzas Militares': 'Militares',
  'Policía Nacional': 'Policía',
  'Docentes Universitarios': 'Docentes Univ.',
  'Docentes de Educación': 'Docentes Educ.',
  'Magistratura': 'Magistratura',
  'Contratados en Obras': 'Contratados Obras',
  'Poder Legislativo': 'Poder Legislativo',
  'Poder Judicial': 'Poder Judicial',
};

const chartBox = { background: 'var(--card-bg)', backdropFilter: 'blur(16px)', padding: '1.2rem 1.4rem', borderRadius: '22px', border: '1px solid rgba(255,255,255,0.4)', boxShadow: 'var(--shadow-glass)', overflow: 'hidden' };

/* ================================================================ */
const CotizantesPanel = ({ db }) => {
  const [serieGrupo, setSerieGrupo] = useState([]);  // [{anio, gran_grupo, funcionarios, monto}]
  const [top20, setTop20] = useState([]);             // [{entidad, funcionarios}]
  const [serieContrato, setSerieContrato] = useState([]); // [{anio, tipo_contrato, funcionarios}]
  const [serieSexo, setSerieSexo] = useState([]);     // [{anio, sexo, funcionarios}]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [anioFiltro, setAnioFiltro] = useState(2024);

  useEffect(() => {
    if (!db) return;
    const run = async () => {
      setLoading(true);
      try {
        const c = await db.connect();

        // Serie anual por gran_grupo
        const r1 = await c.query(`
          SELECT anio, gran_grupo,
                 SUM(cantidad_funcionarios_unicos) AS funcionarios,
                 SUM(monto_total_gastado) AS monto
          FROM 'totales.parquet'
          WHERE gran_grupo IS NOT NULL AND anio <= 2025
          GROUP BY anio, gran_grupo
          ORDER BY anio, funcionarios DESC
        `);
        setSerieGrupo(r1.toArray().map(r => ({
          anio: Number(r.anio),
          grupo: r.gran_grupo,
          funcionarios: Number(r.funcionarios),
          monto: Number(r.monto),
        })));

        // TOP 20 entidades por funcionarios (año seleccionado)
        const r2 = await c.query(`
          SELECT entidad_principal,
                 SUM(cantidad_funcionarios_unicos) AS funcionarios
          FROM 'totales.parquet'
          WHERE anio = ${anioFiltro} AND entidad_principal IS NOT NULL
          GROUP BY entidad_principal
          ORDER BY funcionarios DESC
          LIMIT 20
        `);
        setTop20(r2.toArray().map(r => ({
          entidad: r.entidad_principal,
          funcionarios: Number(r.funcionarios),
        })));

        // Serie anual por tipo de contrato
        const r3 = await c.query(`
          SELECT anio, tipo_contrato,
                 SUM(cantidad_funcionarios_unicos) AS funcionarios
          FROM 'totales.parquet'
          WHERE tipo_contrato IS NOT NULL AND anio <= 2025
          GROUP BY anio, tipo_contrato
          ORDER BY anio
        `);
        setSerieContrato(r3.toArray().map(r => ({
          anio: Number(r.anio),
          tipo: r.tipo_contrato,
          funcionarios: Number(r.funcionarios),
        })));

        // Serie anual por sexo
        const r4 = await c.query(`
          SELECT anio, sexo_canon,
                 SUM(cantidad_funcionarios_unicos) AS funcionarios
          FROM 'totales.parquet'
          WHERE sexo_canon IS NOT NULL AND anio <= 2025
          GROUP BY anio, sexo_canon
          ORDER BY anio
        `);
        setSerieSexo(r4.toArray().map(r => ({
          anio: Number(r.anio),
          sexo: r.sexo_canon,
          funcionarios: Number(r.funcionarios),
        })));

        await c.close();
      } catch (e) {
        setError('Error cargando datos de cotizantes: ' + e.message);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [db, anioFiltro]);

  // ---- Preparar datos para gráficos ----
  const anios = useMemo(() => [...new Set(serieGrupo.map(d => d.anio))].sort(), [serieGrupo]);
  const grupos = useMemo(() => [...new Set(serieGrupo.map(d => d.grupo))], [serieGrupo]);
  const tiposContrato = useMemo(() => [...new Set(serieContrato.map(d => d.tipo))], [serieContrato]);
  const sexos = useMemo(() => [...new Set(serieSexo.map(d => d.sexo))], [serieSexo]);

  const lineByGrupo = useMemo(() => ({
    labels: anios.map(String),
    datasets: grupos.map((grupo, i) => ({
      label: GRUPO_LABELS[grupo] || grupo,
      data: anios.map(a => {
        const row = serieGrupo.find(d => d.anio === a && d.grupo === grupo);
        return row ? row.funcionarios : null;
      }),
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: PALETTE[i % PALETTE.length],
      borderWidth: 2.5,
      pointRadius: 3,
      tension: 0.25,
      fill: false,
    })),
  }), [anios, grupos, serieGrupo]);

  const barTop20 = useMemo(() => ({
    labels: top20.map(d => d.entidad.length > 30 ? d.entidad.slice(0, 28) + '…' : d.entidad),
    datasets: [{
      label: `Funcionarios únicos (${anioFiltro})`,
      data: top20.map(d => d.funcionarios),
      backgroundColor: top20.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
      borderColor: top20.map((_, i) => PALETTE[i % PALETTE.length]),
      borderWidth: 1,
    }],
  }), [top20, anioFiltro]);

  const lineContrato = useMemo(() => ({
    labels: anios.map(String),
    datasets: tiposContrato.map((tipo, i) => ({
      label: tipo,
      data: anios.map(a => {
        const row = serieContrato.find(d => d.anio === a && d.tipo === tipo);
        return row ? row.funcionarios : null;
      }),
      borderColor: PALETTE[i],
      backgroundColor: PALETTE[i] + '30',
      fill: true,
      borderWidth: 2.5,
      pointRadius: 2,
      tension: 0.2,
    })),
  }), [anios, tiposContrato, serieContrato]);

  const lineSexo = useMemo(() => ({
    labels: anios.map(String),
    datasets: sexos.map((sexo, i) => ({
      label: sexo,
      data: anios.map(a => {
        const row = serieSexo.find(d => d.anio === a && d.sexo === sexo);
        return row ? row.funcionarios : null;
      }),
      borderColor: sexo === 'Hombres' ? '#1d4ed8' : '#be123c',
      backgroundColor: (sexo === 'Hombres' ? '#1d4ed8' : '#be123c') + '25',
      fill: true,
      borderWidth: 2.5,
      pointRadius: 2,
      tension: 0.2,
    })),
  }), [anios, sexos, serieSexo]);

  // Doughnut del año seleccionado por grupo
  const donutGrupo = useMemo(() => {
    const datos = grupos.map(g => {
      const row = serieGrupo.find(d => d.anio === anioFiltro && d.grupo === g);
      return { grupo: GRUPO_LABELS[g] || g, val: row ? row.funcionarios : 0 };
    }).filter(d => d.val > 0).sort((a, b) => b.val - a.val).slice(0, 8);
    return {
      labels: datos.map(d => d.grupo),
      datasets: [{ data: datos.map(d => d.val), backgroundColor: PALETTE, borderWidth: 2 }],
    };
  }, [grupos, serieGrupo, anioFiltro]);

  const chartOpts = (titleY) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, usePointStyle: true } },
      tooltip: { callbacks: { label: (ctx) => ` ${fmtN(ctx.raw)} funcionarios` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
      y: { ticks: { callback: v => fmt(v) }, title: { display: !!titleY, text: titleY || '' } },
    },
  });

  const barHorizOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => ` ${fmtN(ctx.raw)}` } },
    },
    scales: {
      x: { ticks: { callback: v => fmt(v) } },
      y: { ticks: { font: { size: 10 } } },
    },
  };

  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 10 } } },
      tooltip: { callbacks: { label: (ctx) => ` ${fmtN(ctx.raw)} (${((ctx.raw / ctx.chart.data.datasets[0].data.reduce((a,b) => a+b,0))*100).toFixed(1)}%)` } },
    },
  };

  // KPIs de resumen
  const totalActual = useMemo(() => {
    const rows = serieGrupo.filter(d => d.anio === anioFiltro);
    return rows.reduce((a, b) => a + b.funcionarios, 0);
  }, [serieGrupo, anioFiltro]);

  const totalAnterior = useMemo(() => {
    const rows = serieGrupo.filter(d => d.anio === anioFiltro - 1);
    return rows.reduce((a, b) => a + b.funcionarios, 0);
  }, [serieGrupo, anioFiltro]);

  const pctCambio = totalAnterior > 0 ? ((totalActual - totalAnterior) / totalAnterior * 100).toFixed(1) : null;

  const permanentesActual = useMemo(() => {
    const rows = serieContrato.filter(d => d.anio === anioFiltro && d.tipo === 'Permanente');
    return rows.reduce((a, b) => a + b.funcionarios, 0);
  }, [serieContrato, anioFiltro]);

  const contratadosActual = useMemo(() => {
    const rows = serieContrato.filter(d => d.anio === anioFiltro && d.tipo === 'Contratado');
    return rows.reduce((a, b) => a + b.funcionarios, 0);
  }, [serieContrato, anioFiltro]);

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>⏳ Cargando datos de cotizantes…</div>;
  if (error) return <div style={{ color: '#b91c1c', padding: '2rem' }}>{error}</div>;

  return (
    <div style={{ padding: '1rem 1.2rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>Estructura de Cotizantes del Estado</h2>
          <p style={{ margin: '0.3rem 0 0', color: '#64748b', fontSize: '0.88rem' }}>Evolución histórica 2015–2025 de los funcionarios públicos por tipo, contrato y género.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>Año de referencia:</label>
          <select value={anioFiltro} onChange={e => setAnioFiltro(Number(e.target.value))}
            style={{ borderRadius: '10px', border: '1px solid #cbd5e1', padding: '0.4rem 0.8rem', fontSize: '0.9rem', background: '#fff', cursor: 'pointer' }}>
            {[2024,2023,2022,2021,2020,2019,2018,2017,2016,2015].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: '0.8rem', marginBottom: '1.1rem' }}>
        {[
          { label: `Total en ${anioFiltro}`, value: fmtN(totalActual), sub: pctCambio ? `${pctCambio > 0 ? '+' : ''}${pctCambio}% vs ${anioFiltro-1}` : '', color: '#0f766e' },
          { label: 'Permanentes', value: fmtN(permanentesActual), sub: `${totalActual > 0 ? ((permanentesActual/totalActual)*100).toFixed(1) : 0}% del total`, color: '#1d4ed8' },
          { label: 'Contratados', value: fmtN(contratadosActual), sub: `${totalActual > 0 ? ((contratadosActual/totalActual)*100).toFixed(1) : 0}% del total`, color: '#7c3aed' },
          { label: 'Top entidad', value: top20[0]?.entidad?.split(' ').slice(0,3).join(' ') || '—', sub: top20[0] ? fmtN(top20[0].funcionarios) + ' func.' : '', color: '#be123c' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ alignItems: 'flex-start', overflow: 'hidden', padding: '0.85rem' }}>
            <span className="kpi-title">{k.label}</span>
            <span className="kpi-value" style={{ color: k.color, fontSize: '1.1rem', wordBreak: 'break-word', lineHeight: 1.2 }}>{k.value}</span>
            <div style={{ color: '#64748b', fontSize: '0.76rem', marginTop: '0.2rem' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Fila 1: Evolución por grupo + Donut */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '1rem', marginBottom: '1rem', minHeight: 0 }}>
        <div style={chartBox}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.6rem' }}>
            Evolución de cotizantes por tipo de función
          </h3>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: '#64748b' }}>
            Cada línea representa un gran grupo de la función pública. Refleja cómo ha cambiado la composición del Estado como empleador.
          </p>
          <div style={{ position: 'relative', height: '260px', overflow: 'hidden' }}>
            <Line data={lineByGrupo} options={chartOpts('Funcionarios')} />
          </div>
        </div>
        <div style={chartBox}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.6rem' }}>
            Distribución por tipo — {anioFiltro}
          </h3>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: '#64748b' }}>Peso relativo de cada gran grupo en el año de referencia.</p>
          <div style={{ position: 'relative', height: '260px', overflow: 'hidden' }}>
            <Doughnut data={donutGrupo} options={donutOpts} />
          </div>
        </div>
      </div>

      {/* Fila 2: Permanentes vs Contratados + Hombres vs Mujeres */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', minHeight: 0 }}>
        <div style={chartBox}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.6rem' }}>Permanentes vs. contratados</h3>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: '#64748b' }}>La relación entre planta permanente y contratos indica la estabilidad de la nómina y la exposición a cambios políticos.</p>
          <div style={{ position: 'relative', height: '220px', overflow: 'hidden' }}>
            <Line data={lineContrato} options={chartOpts()} />
          </div>
        </div>
        <div style={chartBox}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.6rem' }}>Composición por género</h3>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: '#64748b' }}>La feminización del empleo público impacta en las proyecciones de jubilación por diferencias en esperanza de vida y densidad contributiva.</p>
          <div style={{ position: 'relative', height: '220px', overflow: 'hidden' }}>
            <Line data={lineSexo} options={chartOpts()} />
          </div>
        </div>
      </div>

      {/* Fila 3: Top 20 entidades */}
      <div style={chartBox}>
        <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.95rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.6rem' }}>
          Top 20 entidades por cantidad de funcionarios — {anioFiltro}
        </h3>
        <p style={{ margin: '0 0 0.8rem', fontSize: '0.78rem', color: '#64748b' }}>
          Las entidades más grandes concentran la mayor base contributiva. Cambios en su dotación (por reformas, fusiones o privatizaciones) impactan directamente en los ingresos de la Caja Fiscal.
        </p>
        <div style={{ position: 'relative', height: '380px', overflow: 'hidden' }}>
          <Bar data={barTop20} options={barHorizOpts} />
        </div>
      </div>

    </div>
  );
};

export default CotizantesPanel;
