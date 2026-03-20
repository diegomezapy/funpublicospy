import { useState, useEffect, useCallback } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import './App.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const MANUAL_BUNDLES = {
  mvp: {
    mainModule: duckdb_wasm,
    mainWorker: mvp_worker,
  },
  eh: {
    mainModule: duckdb_wasm_eh,
    mainWorker: eh_worker,
  },
};

const formatCurrency = (val) => {
  return new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(val);
};

const escapeSqlValue = (value) => String(value ?? '').replace(/'/g, "''");
const sanitizeCedulaInput = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 12);

import CajaFiscalPanel from './components/CajaFiscalPanel';
import CotizantesPanel from './components/CotizantesPanel';

function App() {
  const [db, setDb] = useState(null);
  const [ready, setReady] = useState(false);
  const [cedulaInput, setCedulaInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // Estados visuales (Pestañas)
  const [activeTab, setActiveTab] = useState('general'); // 'general' | 'particular' | 'tir'
  
  // (Rest of the massive data states exist here undisturbed inside App's logic)
  const [globalData, setGlobalData] = useState([]);
  
  // Filtros Globales
  const [filtroSexo, setFiltroSexo] = useState('Todos');
  const [filtroContrato, setFiltroContrato] = useState('Todos');
  const [filtroEntidad, setFiltroEntidad] = useState('Todas');
  const [filtroConcepto, setFiltroConcepto] = useState('Todos');

  // Listas Dinámicas extraídas del Parquet
  const [entidadesList, setEntidadesList] = useState([]);
  const [conceptosList, setConceptosList] = useState([]);

  // Datos Individuales
  const [personData, setPersonData] = useState([]);
  const [personKpis, setPersonKpis] = useState(null);
  
  // Estados Proyección Actuarial Individual
  const [personAnioNacimiento, setPersonAnioNacimiento] = useState(1980);
  const [personAnioInicioAportes, setPersonAnioInicioAportes] = useState(2005);
  const [personEsperanzaVida, setPersonEsperanzaVida] = useState(15);
  const [personAnioReforma, setPersonAnioReforma] = useState(2027);
  const [personTasaAporteActual, setPersonTasaAporteActual] = useState(16);
  const [personTasaAporteNueva, setPersonTasaAporteNueva] = useState(16);
  const [personCrecimiento, setPersonCrecimiento] = useState(0.02);
  const [personInflacion, setPersonInflacion] = useState(0.04);
  const [personTasaSustitucion, setPersonTasaSustitucion] = useState(1.0);
  const [personActuarial, setPersonActuarial] = useState(null);

// ... (Effect and query logic omitted logically as standard replacement practice, assuming I replace at the top and bottom)


  useEffect(() => {
    // Inicializar DuckDB
    const initDb = async () => {
      try {
        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
        const worker = new Worker(bundle.mainWorker);
        const logger = new duckdb.ConsoleLogger();
        const mydb = new duckdb.AsyncDuckDB(logger, worker);
        await mydb.instantiate(bundle.mainModule, bundle.pthreadWorker);
        // Registrar archivos usando BASE_URL para soportar Github Pages
        const baseUrl = import.meta.env.BASE_URL;
        await mydb.registerFileURL('totales.parquet', `${baseUrl}database/totales_historicos.parquet`, duckdb.DuckDBDataProtocol.HTTP, false);
        await mydb.registerFileURL('cedulas.parquet', `${baseUrl}database/cedula_fechanacim.parquet`, duckdb.DuckDBDataProtocol.HTTP, false);
        await mydb.registerFileURL('proyecciones.parquet', `${baseUrl}database/proyecciones_demograficas.parquet`, duckdb.DuckDBDataProtocol.HTTP, false);
        
        // Registrar Parquets por año (2015 a 2026)
        const anios = Array.from({length: 2026 - 2015 + 1}, (_, i) => 2015 + i);
        for (const anio of anios) {
          await mydb.registerFileURL(`nomina_${anio}.parquet`, `${baseUrl}database/nomina_${anio}.parquet`, duckdb.DuckDBDataProtocol.HTTP, false);
        }

        setDb(mydb);
        
        // Extraer los listados dinámicos de Entidad y Conceptos
        const c1 = await mydb.connect();
        const entRes = await c1.query("SELECT DISTINCT entidad_principal FROM 'totales.parquet' WHERE entidad_principal IS NOT NULL ORDER BY entidad_principal");
        
        // LIMITAR A LOS 150 CONCEPTOS MÁS IMPORTANTES EN EL PRESUPUESTO NACIONAL P/ EVITAR DOM CRASH
        const concRes = await c1.query(`
          SELECT concepto 
          FROM 'totales.parquet' 
          WHERE concepto IS NOT NULL AND concepto != 'NO ESPECIFICADO' 
          GROUP BY concepto 
          ORDER BY SUM(monto_total_gastado) DESC 
          LIMIT 120
        `);
        await c1.close();
        
        const entidades = entRes.toArray().map(r => r.entidad_principal).filter(e => e && e.trim() !== '');
        const conceptos = concRes.toArray().map(r => r.concepto).filter(c => c && c.trim() !== '');
        
        setEntidadesList(entidades);
        setConceptosList(conceptos);

        setReady(true);
        
        // Cargar vista global inicialmente
        await loadGlobalData(mydb, 'Todos', 'Todos', 'Todas', 'Todos');
      } catch (err) {
        console.error("Error inicializando db:", err);
        setError("Error cargando la base de datos.");
      }
    };
    initDb();
  }, []);

  useEffect(() => {
    if (db && ready) {
       loadGlobalData(db, filtroSexo, filtroContrato, filtroEntidad, filtroConcepto);
    }
  }, [filtroSexo, filtroContrato, filtroEntidad, filtroConcepto]);

  useEffect(() => {
    if (personData.length === 0) {
      setPersonActuarial(null);
      return;
    }
    
    // Calcular Proyeccion Actuarial
    const crecNominal = parseFloat(personCrecimiento) + parseFloat(personInflacion);
    const tasaDescuento = crecNominal;
    const inflacion = parseFloat(personInflacion);
    const tasaSustitucion = parseFloat(personTasaSustitucion);
    
    // Agrupar historicals por año para simplificar la capitalizacion
    let histPorAnio = {};
    personData.forEach(d => {
       if(!histPorAnio[d.anio]) histPorAnio[d.anio] = 0;
       histPorAnio[d.anio] += d.monto_total_mes;
    });
    
    const añosReales = Object.keys(histPorAnio).map(Number).sort();
    const primerAnio = añosReales[0];
    const ultimoAnio = añosReales[añosReales.length - 1];

    // Corregir caída visual/actuarial si el último año reportado está incompleto
    const mesesUltimoAnio = personData.filter(d => d.anio === ultimoAnio).length;
    if (mesesUltimoAnio > 0 && mesesUltimoAnio < 12) {
       histPorAnio[ultimoAnio] = (histPorAnio[ultimoAnio] / mesesUltimoAnio) * 13;
    }
    
    const anioNacimiento = personAnioNacimiento;
    
    // Regla de jubilación general (aprox. la que caiga primero en asegurar edad madura + años de aporte base ej: 62 de edad y 20 de antigüedad)
    const anioRetiroPorEdad = anioNacimiento + 62;
    const anioRetiroPorAntiguedad = personAnioInicioAportes + 20;
    const anioRetiro = Math.max(anioRetiroPorEdad, anioRetiroPorAntiguedad);

    // Data para el panel explicativo ciudadano
    const edadAlRetiro = anioRetiro - anioNacimiento;
    const antiguedadAlRetiro = anioRetiro - personAnioInicioAportes;
    
    let vpaAportes = 0;
    
    let edadesProyeccion = [];
    let ingresosActivoProj = [];
    let ingresosPasivoProj = [];
    
    // Sueldo Anual Promedio (Ultimos 5 años reales)
    const ultimos5 = añosReales.slice(-5);
    const sumaUltimos5 = ultimos5.reduce((sum, a) => sum + histPorAnio[a], 0);
    const sueldoAnualPromedio = sumaUltimos5 / ultimos5.length;
    let baseJubilatoriaAnual = sueldoAnualPromedio; 

    // 1. Fase Histórica (Pasado Conocido)
    for(let a = primerAnio; a <= ultimoAnio; a++) {
       const cobradoEseAnio = histPorAnio[a] || 0;
       const tasaAporteHist = a >= personAnioReforma ? (personTasaAporteNueva / 100) : (personTasaAporteActual / 100);
       const aporte = cobradoEseAnio * tasaAporteHist;
       
       // Capitalizar al año de retiro
       vpaAportes += aporte * Math.pow((1 + tasaDescuento), anioRetiro - a);
       
       edadesProyeccion.push(a);
       ingresosActivoProj.push(cobradoEseAnio);
       ingresosPasivoProj.push(null);
    }
    
    // Modelo de Serie de Tiempo (Regresión Lineal Simple) sobre el historial real
    const nSeries = añosReales.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    añosReales.forEach(a => {
       const x = a - primerAnio; // Normalizar X
       const y = histPorAnio[a];
       sumX += x;
       sumY += y;
       sumXY += (x * y);
       sumX2 += (x * x);
    });
    
    let slope = 0;
    let intercept = histPorAnio[ultimoAnio] || 0;
    if (nSeries > 1) {
       slope = (nSeries * sumXY - sumX * sumY) / (nSeries * sumX2 - sumX * sumX);
       intercept = (sumY - slope * sumX) / nSeries;
    }
    // Si la regresión es negativa, asumimos estabilidad (0)
    if (slope < 0) slope = 0;

    let anioSiguiente = ultimoAnio + 1;
    let ultimoSueldoAnual = histPorAnio[ultimoAnio];
    
    while(anioSiguiente <= anioRetiro) {
       if(anioSiguiente < anioRetiro) {
           // Proyección por Serie de Tiempo
           let x_futuro = anioSiguiente - primerAnio;
           let forecastLineal = slope * x_futuro + intercept;
           
           // Aseguramos que mínimo empate con la inflación para no perder poder adquisitivo base
           let minimoInflacionario = ultimoSueldoAnual * (1 + inflacion);
           ultimoSueldoAnual = Math.max(forecastLineal, minimoInflacionario);
           
           const tasaAporteProy = anioSiguiente >= personAnioReforma ? (personTasaAporteNueva / 100) : (personTasaAporteActual / 100);
           const aporte = ultimoSueldoAnual * tasaAporteProy;
           vpaAportes += aporte * Math.pow((1 + tasaDescuento), anioRetiro - anioSiguiente);
       }
       baseJubilatoriaAnual = ultimoSueldoAnual;
       
       edadesProyeccion.push(anioSiguiente);
       ingresosActivoProj.push(ultimoSueldoAnual);
       ingresosPasivoProj.push(null);
       anioSiguiente++;
    }
    
    // 3. Fase Proyectada Pasiva (Jubilación hasta Esperanza de Vida)
    const esperanzaV = personEsperanzaVida;
    const anioMuerte = anioRetiro + esperanzaV;
    let vpaBeneficios = 0;
    
    const primerBeneficioVitalicio = baseJubilatoriaAnual * tasaSustitucion;
    let beneficioCurrent = primerBeneficioVitalicio;
    
    for(let a = anioRetiro + 1; a <= anioMuerte; a++) {
       beneficioCurrent = beneficioCurrent * (1 + inflacion);
       
       // Descontar al año de retiro (en t=0, que es anioRetiro)
       vpaBeneficios += beneficioCurrent / Math.pow((1 + tasaDescuento), a - anioRetiro);
       
       edadesProyeccion.push(a);
       ingresosActivoProj.push(null);
       ingresosPasivoProj.push(beneficioCurrent);
    }
    
    // Empalme visual (El bug del "disparo" se daba porque beneficioCurrent crecía en el loop)
    const idxRetiro = edadesProyeccion.indexOf(anioRetiro);
    if(idxRetiro >= 0) {
      ingresosPasivoProj[idxRetiro] = primerBeneficioVitalicio;
    }

    setPersonActuarial({
       anioRetiro,
       edadAlRetiro,
       antiguedadAlRetiro,
       primerBeneficioVitalicio,
       tasaSustitucion,
       vpaAportes,
       vpaBeneficios,
       labels: edadesProyeccion.map(String),
       ingresosActivos: ingresosActivoProj,
       ingresosPasivos: ingresosPasivoProj
    });

  }, [personData, personAnioNacimiento, personAnioInicioAportes, personEsperanzaVida, personAnioReforma, personTasaAporteActual, personTasaAporteNueva, personCrecimiento, personInflacion, personTasaSustitucion]);

  const loadGlobalData = useCallback(async (database, s = filtroSexo, c = filtroContrato, e = filtroEntidad, conc = filtroConcepto) => {
    if (!database) return;
    const conn = await database.connect();
    try {
      const whereClauses = [];
      if (s !== 'Todos') whereClauses.push(`sexo_canon = '${escapeSqlValue(s)}'`);
      if (c !== 'Todos') whereClauses.push(`tipo_contrato = '${escapeSqlValue(c)}'`);
      if (e !== 'Todas') whereClauses.push(`entidad_principal = '${escapeSqlValue(e)}'`);
      if (conc !== 'Todos') whereClauses.push(`concepto = '${escapeSqlValue(conc)}'`);
      whereClauses.push(`anio <= 2025`);

      const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
      const query = `
        SELECT anio, mes, gran_grupo, 
               CAST(SUM(monto_total_gastado) AS BIGINT) as monto_total_gastado, 
               CAST(SUM(cantidad_funcionarios_unicos) AS BIGINT) as cantidad_funcionarios_unicos,
               CAST(SUM(hombres) AS BIGINT) as hombres, CAST(SUM(mujeres) AS BIGINT) as mujeres,
               CAST(SUM(permanentes) AS BIGINT) as permanentes, CAST(SUM(contratados) AS BIGINT) as contratados,
               CAST(AVG(salario_p10) AS BIGINT) as salario_p10,
               CAST(AVG(salario_mediana) AS BIGINT) as salario_mediana,
               CAST(AVG(salario_p90) AS BIGINT) as salario_p90
        FROM 'totales.parquet' 
        ${whereSQL}
        GROUP BY anio, mes, gran_grupo
        ORDER BY anio, mes
      `;
      const result = await conn.query(query);

      const rows = result.toArray().map(r => {
        const row = r.toJSON();
        for (const key in row) {
          if (typeof row[key] === 'bigint') row[key] = Number(row[key]);
        }
        return row;
      });
      setGlobalData(rows);
    } catch (err) {
      console.error(err);
      setError('Error cargando datos globales.');
    } finally {
      await conn.close();
    }
  }, [filtroSexo, filtroContrato, filtroEntidad, filtroConcepto]);

  const handleSearchClick = async () => {
    const cedulaSanitizada = sanitizeCedulaInput(cedulaInput);
    if (!cedulaSanitizada) {
      setError('Ingrese una cédula válida, solo dígitos.');
      setPersonData([]);
      setPersonKpis(null);
      return;
    }
    if (!db) {
      setError('La base analítica aún no está lista.');
      return;
    }
    if (cedulaSanitizada !== cedulaInput) setCedulaInput(cedulaSanitizada);
    setError('');
    setSearching(true);

    const conn = await db.connect();
    try {
      const query = `
        SELECT n.anio, n.mes, n.entidad_principal, n.monto_total_mes,
               c.anio_nacim, c.mes_nacim, c.dia_nacim, c.sexo,
               (n.anio - COALESCE(c.anio_nacim, 0) +
                CASE WHEN n.mes >= COALESCE(c.mes_nacim, 1) THEN 0 ELSE -1 END) AS edad_en_mes
        FROM read_parquet('nomina_*.parquet') n
        LEFT JOIN 'cedulas.parquet' c ON CAST(n.cedula AS BIGINT) = c.nro_cedula
        WHERE CAST(n.cedula AS VARCHAR) = '${cedulaSanitizada}' AND n.anio <= 2025
        ORDER BY n.anio, n.mes
      `;
      const result = await conn.query(query);
      const rows = result.toArray().map(r => {
        const row = r.toJSON();
        for (const key in row) {
          if (typeof row[key] === 'bigint') row[key] = Number(row[key]);
        }
        return row;
      });

      if (rows.length === 0) {
        setPersonData([]);
        setPersonKpis(null);
      } else {
        setPersonData(rows);

        let max_salario = 0;
        let sum_salarios = 0;

        rows.forEach(r => {
          if (r.monto_total_mes > max_salario) max_salario = r.monto_total_mes;
          sum_salarios += r.monto_total_mes;
        });

        const primer_mes = rows[0].monto_total_mes;
        const ultimo_mes = rows[rows.length - 1].monto_total_mes;
        const aumento = ((ultimo_mes - primer_mes) / (primer_mes || 1)) * 100;

        const ultimo_anio = rows[rows.length - 1].anio;
        const ultimo_mes_val = rows[rows.length - 1].mes;
        const entidades_actuales = Array.from(new Set(rows.filter(r => r.anio === ultimo_anio && r.mes === ultimo_mes_val).map(r => r.entidad_principal))).join(' / ');

        const anio_nacim = rows[0].anio_nacim || null;
        const mes_nacim  = rows[0].mes_nacim  || null;
        const sexo       = rows[0].sexo       || '?';
        const edad_actual = rows[rows.length - 1].edad_en_mes ?? (anio_nacim ? (ultimo_anio - anio_nacim) : null);

        setPersonKpis({
          max_salario,
          promedio: sum_salarios / rows.length,
          aumento_pct: aumento,
          entidad_actual: entidades_actuales,
          anio_nacim,
          mes_nacim,
          sexo,
          edad_actual,
        });

        if (anio_nacim) {
          setPersonAnioNacimiento(anio_nacim);
        }
      }
    } catch (err) {
      console.error(err);
      setError('Error buscando la cédula.');
    } finally {
      await conn.close();
      setSearching(false);
    }
  };


  const clearSearch = () => {
    setCedulaInput('');
    setPersonData([]);
    setPersonKpis(null);
    setPersonActuarial(null);
    setError('');
  };

  // =============== RENDERIZADOS DE GRÁFICOS ===============
  
  const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { font: { family: 'Inter', size: 13, weight: '500' }, color: '#475569' } },
      tooltip: { 
        backgroundColor: 'rgba(15, 23, 42, 0.9)', 
        titleFont: { family: 'Plus Jakarta Sans', size: 14 }, 
        bodyFont: { family: 'Inter', size: 13 }, 
        padding: 12, 
        cornerRadius: 12,
        boxPadding: 4
      }
    },
    scales: {
      x: { 
        grid: { display: false }, 
        ticks: { font: { family: 'Inter', size: 12 }, color: '#64748b' },
        border: { display: false },
        title: { display: true, text: 'Año y Mes', font: { family: 'Inter', size: 13, weight: 'bold' } }
      },
      y: { 
        border: { display: false, dash: [4, 4] }, 
        grid: { color: 'rgba(226, 232, 240, 0.6)', drawTicks: false }, 
        ticks: { font: { family: 'Inter', size: 12 }, color: '#64748b', padding: 10 },
        title: { display: true, text: 'Monto (Guaraníes) / Cuantía', font: { family: 'Inter', size: 13, weight: 'bold' } }
      }
    },
    elements: {
      bar: { borderRadius: 4, borderSkipped: false },
      line: { tension: 0.4, borderJoinStyle: 'round' },
      point: { radius: 2, hoverRadius: 6 }
    }
  };

  const renderGlobalCharts = () => {
    if (error && activeTab === 'general') {
      return (
        <div style={{textAlign: 'center', marginTop: '2rem'}}>
          <div className="error-message">{error}</div>
        </div>
      );
    }
    if (globalData.length === 0) return (
      <div style={{textAlign: 'center', margin: '2rem'}}>
        <div className="spinner" style={{margin: '0 auto 1rem'}}></div>
        <p>Cargando métricas globales...</p>
      </div>
    );
    
    const uniqueLabels = Array.from(new Set(globalData.map(d => `${d.anio}-${String(d.mes).padStart(2,'0')}`))).sort();
    const uniqueGroups = Array.from(new Set(globalData.map(d => d.gran_grupo)));
    
    const lastLabel = uniqueLabels[uniqueLabels.length - 1];
    const [lastAnio, lastMes] = lastLabel ? lastLabel.split('-') : [new Date().getFullYear(), 1];
    
    const totalFunc = globalData
        .filter(d => String(d.anio) === String(lastAnio) && String(d.mes).padStart(2,'0') === String(lastMes))
        .reduce((sum, d) => sum + d.cantidad_funcionarios_unicos, 0);

    const lastGasto = globalData
        .filter(d => String(d.anio) === String(lastAnio) && String(d.mes).padStart(2,'0') === String(lastMes))
        .reduce((sum, d) => sum + d.monto_total_gastado, 0);
        
    const avgState = totalFunc > 0 ? (lastGasto / totalFunc) : 0;
    
    const lastP10 = globalData
        .filter(d => String(d.anio) === String(lastAnio) && String(d.mes).padStart(2,'0') === String(lastMes))
        .reduce((sum, d) => sum + (d.salario_p10 * d.cantidad_funcionarios_unicos), 0) / (totalFunc || 1);
        
    const lastP90 = globalData
        .filter(d => String(d.anio) === String(lastAnio) && String(d.mes).padStart(2,'0') === String(lastMes))
        .reduce((sum, d) => sum + (d.salario_p90 * d.cantidad_funcionarios_unicos), 0) / (totalFunc || 1);
    
    const colors = [
      '#4f46e5', '#10b981', '#f59e0b', '#ef4444', 
      '#8b5cf6', '#14b8a6', '#f43f5e', '#ec4899', '#06b6d4'
    ];

    const datasetsGasto = uniqueGroups.map((grupo, index) => {
      const data = uniqueLabels.map(label => {
        const [anio, mes] = label.split('-');
        const row = globalData.find(d => 
          String(d.anio) === anio && 
          String(d.mes).padStart(2, '0') === mes && 
          d.gran_grupo === grupo
        );
        return row ? row.monto_total_gastado : 0;
      });
      const color = colors[index % colors.length];
      return {
        label: grupo,
        data,
        backgroundColor: color,
        stack: 'Stack 0',
      };
    });

    const dataTotalGasto = uniqueLabels.map(label => {
      const [anio, mes] = label.split('-');
      return globalData
        .filter(d => String(d.anio) === anio && String(d.mes).padStart(2, '0') === mes)
        .reduce((sum, d) => sum + d.monto_total_gastado, 0);
    });

    const datasetTotalGasto = {
      label: 'TOTAL GASTO',
      data: dataTotalGasto,
      type: 'line',
      borderColor: '#0f172a',
      backgroundColor: '#0f172a',
      borderWidth: 3,
      fill: false,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 6,
      order: -1
    };

    const datasetsPromedio = uniqueGroups.map((grupo, index) => {
      const data = uniqueLabels.map(label => {
        const [anio, mes] = label.split('-');
        const row = globalData.find(d => 
          String(d.anio) === anio && 
          String(d.mes).padStart(2, '0') === mes && 
          d.gran_grupo === grupo
        );
        return row ? row.salario_mediana : null;
      });
      const color = colors[index % colors.length];
      return {
        label: grupo,
        data,
        borderColor: color,
        backgroundColor: color + '33',
        fill: false,
        tension: 0.4,
        spanGaps: true
      };
    });

    const dataTotalPromedio = uniqueLabels.map(label => {
      const [anio, mes] = label.split('-');
      const rowsMonth = globalData.filter(d => String(d.anio) === anio && String(d.mes).padStart(2, '0') === mes);
      const totalFuncs = rowsMonth.reduce((sum, d) => sum + d.cantidad_funcionarios_unicos, 0);
      const totalGastoMonth = rowsMonth.reduce((sum, d) => sum + d.monto_total_gastado, 0);
      return totalFuncs > 0 ? (totalGastoMonth / totalFuncs) : null;
    });

    const datasetTotalPromedio = {
      label: 'PROMEDIO GENERAL',
      data: dataTotalPromedio,
      type: 'line',
      borderColor: '#0f172a',
      backgroundColor: '#0f172a',
      borderWidth: 3,
      borderDash: [5, 5],
      fill: false,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 6,
      order: -1
    };

    const dataGasto = {
      labels: uniqueLabels,
      datasets: [...datasetsGasto, datasetTotalGasto]
    };

    const dataPromedio = {
      labels: uniqueLabels,
      datasets: [...datasetsPromedio, datasetTotalPromedio]
    };

    // --- Datos de Composición (Último Mes) ---
    const lastMonthData = globalData.filter(d => String(d.anio) === String(lastAnio) && String(d.mes).padStart(2,'0') === String(lastMes));
    const labelsGroups = uniqueGroups;

    const dataSexo = {
      labels: labelsGroups,
      datasets: [
        {
          label: 'Hombres',
          data: labelsGroups.map(grupo => {
            const row = lastMonthData.find(d => d.gran_grupo === grupo);
            return row ? row.hombres : 0;
          }),
          backgroundColor: '#3b82f6',
        },
        {
          label: 'Mujeres',
          data: labelsGroups.map(grupo => {
            const row = lastMonthData.find(d => d.gran_grupo === grupo);
            return row ? row.mujeres : 0;
          }),
          backgroundColor: '#ec4899',
        }
      ]
    };

    const dataContrato = {
      labels: labelsGroups,
      datasets: [
        {
          label: 'Permanentes',
          data: labelsGroups.map(grupo => {
            const row = lastMonthData.find(d => d.gran_grupo === grupo);
            return row ? row.permanentes : 0;
          }),
          backgroundColor: '#10b981',
        },
        {
          label: 'Contratados',
          data: labelsGroups.map(grupo => {
            const row = lastMonthData.find(d => d.gran_grupo === grupo);
            return row ? row.contratados : 0;
          }),
          backgroundColor: '#f59e0b',
        }
      ]
    };

    return (
      <>
        <div className="kpi-grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))'}}>
           <div className="kpi-card" title="Incluye pluriempleo y cobro de múltiples conceptos simultáneos por una misma persona.">
              <span className="kpi-title">Vínculos Salariales Emitidos</span>
              <span className="kpi-value">{new Intl.NumberFormat('es-PY').format(totalFunc)}</span>
           </div>
           <div className="kpi-card">
              <span className="kpi-title">Ingreso Medio del Estado</span>
              <span className="kpi-value">{formatCurrency(avgState)}</span>
           </div>
           <div className="kpi-card" style={{borderLeft: '4px solid #10b981'}}>
              <span className="kpi-title">Piso Salarial Representativo (P10)</span>
              <span className="kpi-value" style={{color: '#10b981'}}>{formatCurrency(lastP10)}</span>
           </div>
           <div className="kpi-card" style={{borderLeft: '4px solid #f43f5e'}}>
              <span className="kpi-title">Techo Salarial Funcionario (P90)</span>
              <span className="kpi-value" style={{color: '#f43f5e'}}>{formatCurrency(lastP90)}</span>
           </div>
        </div>

        <div className="filtros-panel" style={{display: 'flex', gap: '1.5rem', justifyContent: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', maxWidth: '1000px'}}>
          
          <div style={{display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 200px'}}>
            <label style={{color: '#334155'}}><strong>Entidad Institucional:</strong></label>
            <select value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)} style={{width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none'}}>
              <option value="Todas">Métricas de Todo el País</option>
              {entidadesList.map((ent, i) => <option key={i} value={ent}>{ent}</option>)}
            </select>
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 200px'}}>
            <label style={{color: '#334155'}}><strong>Objeto de Gasto:</strong></label>
            <select value={filtroConcepto} onChange={(e) => setFiltroConcepto(e.target.value)} style={{width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none'}}>
              <option value="Todos">Absolutamente Todos</option>
              {conceptosList.map((conc, i) => <option key={i} value={conc}>{conc}</option>)}
            </select>
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 120px'}}>
            <label style={{color: '#334155'}}><strong>Sexo:</strong></label>
            <select value={filtroSexo} onChange={(e) => setFiltroSexo(e.target.value)} style={{width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none'}}>
              <option value="Todos">Todos</option>
              <option value="Hombres">Hombres</option>
              <option value="Mujeres">Mujeres</option>
            </select>
          </div>
          
          <div style={{display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 120px'}}>
            <label style={{color: '#334155'}}><strong>Vínculo:</strong></label>
            <select value={filtroContrato} onChange={(e) => setFiltroContrato(e.target.value)} style={{width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none'}}>
              <option value="Todos">Todos</option>
              <option value="Permanente">Nombrado / Permanente</option>
              <option value="Contratado">Contratado</option>
              <option value="Otros">Otros</option>
            </select>
          </div>

        </div>
        
        <div className="chart-container">
          <h3 className="chart-title">Evolución Mediana Salarial (Sector Público)</h3>
          <p style={{textAlign: 'center', fontSize: '0.85rem', color: '#64748b', marginTop: '-10px', marginBottom: '15px'}}>La Mediana elimina el sesgo de salarios extremos</p>
          <Line data={dataPromedio} options={commonChartOptions} />
        </div>

        <div className="chart-container">
          <h3 className="chart-title">Evolución Gasto Público Salarial Total (Apilado)</h3>
          <p style={{textAlign: 'center', fontSize: '0.85rem', color: '#64748b', marginTop: '-10px', marginBottom: '15px'}}>Representa el dinero absoluto transferido por el estado a los estamentos seleccionados.</p>
          <Bar data={dataGasto} options={{
             ...commonChartOptions,
             scales: {
               x: { ...commonChartOptions.scales.x, stacked: true },
               y: { ...commonChartOptions.scales.y, stacked: true, title: { display: true, text: 'Gasto Absoluto (Paraguay)', font: { family: 'Inter', size: 13, weight: 'bold' } } }
             }
          }} />
        </div>
        
        <div style={{backgroundColor: '#e0f2fe', borderLeft: '4px solid #0284c7', padding: '15px', color: '#0369a1', margin: '20px auto', borderRadius: '4px', maxWidth: '1000px', fontSize: '0.9rem'}}>
           <strong>Nota Metodológica sobre la Cantidad de Personas:</strong> El motor de cruce analítico expone el volumen de "Vínculos de Pago" en lugar de "Cédulas Únicas" estáticas. Debido al pluriempleo salarial (un maestro cobrando en dos instituciones) y la multiplicidad de Conceptos (Sueldo + Bonificaciones cruzadas), la sumatoria arroja un número superior (Ej. 800.000+) en contraste a la base fisiológica de ~300.000 funcionarios reales nominales. Úsense estos gráficos demográficos como representación del impacto contractual.
        </div>
        
        <div style={{display: 'flex', gap: '20px', flexWrap: 'wrap'}}>
          <div className="chart-container" style={{flex: 1, minWidth: '300px'}}>
            <h3 className="chart-title">Composición por Sexo (Último Mes)</h3>
            <Bar data={dataSexo} options={{
               ...commonChartOptions,
               indexAxis: 'y', // Hacerlo horizontal para que se lean bien los grupos
               scales: {
                 x: { ...commonChartOptions.scales.x, stacked: true, grid: { color: 'rgba(226, 232, 240, 0.6)' }, title: { display: true, text: 'Cantidad de Vínculos/Pagos', font: { family: 'Inter', size: 13, weight: 'bold' } } },
                 y: { ...commonChartOptions.scales.y, stacked: true, grid: { display: false }, title: { display: true, text: 'Sector Laboral', font: { family: 'Inter', size: 13, weight: 'bold' } } }
               }
            }} />
          </div>
          <div className="chart-container" style={{flex: 1, minWidth: '300px'}}>
            <h3 className="chart-title">Composición por Contrato (Último Mes)</h3>
            <Bar data={dataContrato} options={{
               ...commonChartOptions,
               indexAxis: 'y',
               scales: {
                 x: { ...commonChartOptions.scales.x, stacked: true, grid: { color: 'rgba(226, 232, 240, 0.6)' }, title: { display: true, text: 'Cantidad de Vínculos/Pagos', font: { family: 'Inter', size: 13, weight: 'bold' } } },
                 y: { ...commonChartOptions.scales.y, stacked: true, grid: { display: false }, title: { display: true, text: 'Sector Laboral', font: { family: 'Inter', size: 13, weight: 'bold' } } }
               }
            }} />
          </div>
        </div>
        
        <div className="data-table-container">
          <div className="table-header">
            <h3>Distribución Laboral Salarial ({lastAnio}-{String(lastMes).padStart(2,'0')})</h3>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Grupo/Sector Laboral</th>
                  <th style={{textAlign: 'right'}} title="Número acumulado de salarios pagados.">N° Vínculos Cobrados</th>
                  <th style={{textAlign: 'right'}}>Mediana Salarial (G)</th>
                  <th style={{textAlign: 'right'}}>Techo Salarial P90 (G)</th>
                  <th style={{textAlign: 'right'}}>Gasto Total (M)</th>
                </tr>
              </thead>
              <tbody>
                {lastMonthData.sort((a,b) => b.cantidad_funcionarios_unicos - a.cantidad_funcionarios_unicos).map((row, idx) => (
                  <tr key={idx}>
                    <td><strong>{row.gran_grupo}</strong></td>
                    <td style={{textAlign: 'right'}}>{new Intl.NumberFormat('es-PY').format(row.cantidad_funcionarios_unicos)}</td>
                    <td className="currency-cell" style={{textAlign: 'right'}}>{formatCurrency(row.salario_mediana)}</td>
                    <td className="currency-cell" style={{textAlign: 'right', color: '#f43f5e'}}>{formatCurrency(row.salario_p90)}</td>
                    <td style={{textAlign: 'right', fontWeight: '500', color: '#475569'}}>{formatCurrency(row.monto_total_gastado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };
  
  const renderIndividualCharts = () => {
    if (personData.length === 0) {
      return (
        <div className="not-found">
           {cedulaInput ? (
             <>No se encontraron registros para la cédula: <b>{cedulaInput}</b></>
           ) : (
             <>Ingrese un número de cédula para ver su historial en el Estado</>
           )}
        </div>
      );
    }
    
    const uniqueLabels = Array.from(new Set(personData.map(d => `${d.anio}-${String(d.mes).padStart(2,'0')}`))).sort();
    const uniqueEntities = Array.from(new Set(personData.map(d => d.entidad_principal)));

    const colors = [
      '#4f46e5', '#10b981', '#f59e0b', '#ef4444', 
      '#8b5cf6', '#14b8a6', '#f43f5e', '#ec4899', '#06b6d4'
    ];

    const datasets = uniqueEntities.map((entidad, index) => {
      const data = uniqueLabels.map(label => {
        const [anio, mes] = label.split('-');
        const row = personData.find(d => 
          String(d.anio) === anio && 
          String(d.mes).padStart(2, '0') === mes && 
          d.entidad_principal === entidad
        );
        return row ? row.monto_total_mes : null;
      });
      
      const color = colors[index % colors.length];

      return {
        label: entidad,
        data,
        borderColor: color,
        backgroundColor: color + '33',
        fill: false,
        pointRadius: 4,
        tension: 0.1,
        spanGaps: true
      };
    });
    
    const dataSueldo = {
      labels: uniqueLabels,
      datasets
    };
    
    // Detectar anomalías (aumentos bruscos)
    const tieneAnomalia = personKpis.aumento_pct > 50; 

    return (
      <>
        {/* Badge biográfico */}
        {personKpis.anio_nacim && (
          <div style={{ display:'inline-flex', alignItems:'center', gap:'0.5rem', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'999px', padding:'0.35rem 0.9rem', marginBottom:'1rem', fontSize:'0.82rem', color:'#15803d', fontWeight:700 }}>
            🎂 Datos biográficos encontrados en la base de cédulas del Estado — año de nacimiento pre-cargado en el estimador actuarial
          </div>
        )}
        <div className="kpi-grid">
           <div className="kpi-card">
              <span className="kpi-title">Entidad Actual</span>
              <span className="kpi-value" style={{fontSize: '1.2rem'}}>{personKpis.entidad_actual}</span>
           </div>
           <div className="kpi-card">
              <span className="kpi-title">Ingreso Promedio</span>
              <span className="kpi-value">{formatCurrency(personKpis.promedio)}</span>
           </div>
           <div className="kpi-card" style={tieneAnomalia ? { border: '2px solid var(--danger)'} : {}}>
              <span className="kpi-title">Variación Histórica</span>
              <span className="kpi-value" style={{color: tieneAnomalia ? 'var(--danger)' : 'var(--secondary)'}}>
                {personKpis.aumento_pct > 0 ? '+' : ''}{personKpis.aumento_pct.toFixed(1)}%
              </span>
              {tieneAnomalia && <span style={{color: 'var(--danger)', fontSize: '0.8rem', marginTop:'0.5rem'}}>Anomalía: Aumento Exuberante</span>}
           </div>
           {personKpis.anio_nacim && (
             <div className="kpi-card" style={{borderLeft:'4px solid #0f766e'}}>
               <span className="kpi-title">Año de Nacimiento</span>
               <span className="kpi-value" style={{color:'#0f766e', fontSize:'1.6rem'}}>{personKpis.anio_nacim}</span>
               <span style={{fontSize:'0.8rem', color:'#64748b', marginTop:'0.3rem'}}>{personKpis.sexo === 'F' ? '♀ Mujer' : personKpis.sexo === 'M' ? '♂ Hombre' : 'Sexo no identificado'}</span>
             </div>
           )}
           {personKpis.edad_actual && (
             <div className="kpi-card" style={{borderLeft:'4px solid #7c3aed'}}>
               <span className="kpi-title">Edad al último registro</span>
               <span className="kpi-value" style={{color:'#7c3aed', fontSize:'1.6rem'}}>{personKpis.edad_actual} años</span>
               <span style={{fontSize:'0.8rem', color:'#64748b', marginTop:'0.3rem'}}>Calculada sobre nómina {personData[personData.length-1]?.anio}</span>
             </div>
           )}
        </div>
        
        <div className="chart-container">
          <h3 className="chart-title">Evolución de Ingresos Cédula {cedulaInput}</h3>
          <Line data={dataSueldo} options={{...commonChartOptions, scales: { x: { title: { display: true, text: 'Año y Mes' } }, y: { title: { display: true, text: 'Monto Salarial Percibido (G)' } } }, elements: { ...commonChartOptions.elements, line: { tension: 0.2 } }}} />
        </div>
        
        <div className="data-table-container">
          <div className="table-header">
            <h3>Histórico de Ingresos Puros en Planillas</h3>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Año</th>
                  <th>Mes</th>
                  <th>Institución Patrocinadora</th>
                  <th style={{textAlign: 'right'}}>Cobro Devengado</th>
                </tr>
              </thead>
              <tbody>
                {[...personData].reverse().map((row, idx) => (
                  <tr key={idx}>
                    <td style={{width: '80px', color: '#64748b'}}><strong>{row.anio}</strong></td>
                    <td style={{width: '60px', color: '#64748b'}}>{String(row.mes).padStart(2, '0')}</td>
                    <td>{row.entidad_principal}</td>
                    <td className="currency-cell" style={{textAlign: 'right'}}>{formatCurrency(row.monto_total_mes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panel Actuarial Dinámico Integrado */}
        <div style={{marginTop: '30px', backgroundColor: '#f8fafc', padding: '25px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}>
          <h3 style={{marginTop: 0, color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px'}}>Estudio Actuarial Personalizado</h3>
          <p style={{fontSize: '0.85rem', color: '#64748b', marginBottom: '20px'}}>Complete sus datos biológicos para que el algoritmo determine su fecha de jubilación proyectada y compare el valor presente de los impuestos que el Estado ahorró desde que empezó a trabajar vs el valor de los beneficios que le tendrá que pagar hasta su fallecimiento.</p>
          
          <div style={{display: 'flex', gap: '20px', marginBottom: '25px', flexWrap: 'wrap'}}>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Año Nacimiento</label>
              <input type="number" value={personAnioNacimiento} onChange={e => setPersonAnioNacimiento(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Año de Ingreso (Aportes)</label>
              <input type="number" value={personAnioInicioAportes} onChange={e => setPersonAnioInicioAportes(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Años Vida tras Jubilación</label>
              <input type="number" value={personEsperanzaVida} onChange={e => setPersonEsperanzaVida(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Año de Reforma de Ley</label>
              <input type="number" value={personAnioReforma} onChange={e => setPersonAnioReforma(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Aporte PRE-Reforma (%)</label>
              <input type="number" step="0.5" value={personTasaAporteActual} onChange={e => setPersonTasaAporteActual(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Aporte POS-Reforma (%)</label>
              <input type="number" step="0.5" value={personTasaAporteNueva} onChange={e => setPersonTasaAporteNueva(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Tasa de Sustitución Prometida</label>
              <select value={personTasaSustitucion} onChange={e => setPersonTasaSustitucion(Number(e.target.value))} style={{padding: '8px', width: '180px'}}>
                <option value={1.0}>100% (Administrativos)</option>
                <option value={0.93}>93% (Docentes)</option>
                <option value={0.6}>60% (Capitalización priv.)</option>
              </select>
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>% Crecimiento Real PBI</label>
              <input type="number" step="0.01" value={personCrecimiento} onChange={e => setPersonCrecimiento(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>% Inflación Anual</label>
              <input type="number" step="0.01" value={personInflacion} onChange={e => setPersonInflacion(Number(e.target.value))} style={{padding: '8px', width: '150px'}} />
            </div>
          </div>
          
          {personActuarial && (
             <div style={{display: 'flex', gap: '30px', flexWrap: 'wrap'}}>
                <div style={{flex: '1 1 300px'}}>
                  <h4 style={{margin: '0 0 15px 0', color: '#475569'}}>Glosario Ciudadano de su Retiro</h4>
                  
                  <div style={{backgroundColor: '#eff6ff', borderLeft: '4px solid #3b82f6', padding: '15px', borderRadius: '4px', marginBottom: '20px'}}>
                    <h5 style={{margin: '0 0 10px 0', color: '#1e3a8a', fontSize: '1.05rem'}}>¿Cuándo y cómo me jubilaré?</h5>
                    <p style={{margin: '0 0 8px 0', fontSize: '0.9rem', lineHeight: '1.5', color: '#334155'}}>
                      Basado en tu biografía laboral, alcanzarás los requisitos en el <strong>año {personActuarial.anioRetiro}</strong>. 
                      Para ese entonces tendrás <strong>{personActuarial.edadAlRetiro} años de edad</strong> y habrás aportado al Estado por <strong>{personActuarial.antiguedadAlRetiro} años de antigüedad</strong>.
                    </p>
                    <p style={{margin: 0, fontSize: '0.9rem', lineHeight: '1.5', color: '#334155'}}>
                      Al jubilarte en {personActuarial.anioRetiro}, se te promete pagar el <strong>{(personActuarial.tasaSustitucion * 100).toFixed(0)}%</strong> de tu salario activo. 
                      Esto significa que tu primer sueldo como jubilado sería aproximadamente de <strong>{formatCurrency(personActuarial.primerBeneficioVitalicio)} mensuales</strong> (a valores reales futuros considerando tu progresión salarial regular y la inflación).
                    </p>
                  </div>

                  <h4 style={{margin: '0 0 15px 0', color: '#475569'}}>Resultados Financieros (Valor Presente)</h4>
                  <ul style={{listStyle: 'none', padding: 0, margin: 0, fontSize: '0.95rem'}}>
                    <li style={{marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0'}}>
                      <strong>Año Clave de Jubilación Estimada:</strong> <br/>
                      <span style={{color: '#3b82f6', fontWeight: 'bold', fontSize: '1.2rem'}}>{personActuarial.anioRetiro}</span>
                    </li>
                    <li style={{marginBottom: '10px'}}>
                      <span style={{color: '#64748b'}}>Valor de Aportes Pagados Exigidos al Funcionario:</span> <br/>
                      <strong>{formatCurrency(personActuarial.vpaAportes)}</strong>
                    </li>
                    <li style={{marginBottom: '10px'}}>
                      <span style={{color: '#64748b'}}>Valor de Beneficios Pagados por el Estado:</span> <br/>
                      <strong>{formatCurrency(personActuarial.vpaBeneficios)}</strong>
                    </li>
                    <li style={{marginTop: '20px', padding: '15px', backgroundColor: (personActuarial.vpaAportes - personActuarial.vpaBeneficios) >= 0 ? '#f0fdf4' : '#fef2f2', border: '1px solid ' + ((personActuarial.vpaAportes - personActuarial.vpaBeneficios) >= 0 ? '#bbf7d0' : '#fecaca'), borderRadius: '6px'}}>
                       <strong style={{color: '#334155'}}>Balance (Déficit / Superávit para el País):</strong> <br/>
                       <span style={{fontSize: '1.4rem', color: (personActuarial.vpaAportes - personActuarial.vpaBeneficios) >= 0 ? '#15803d' : '#b91c1c', fontWeight: 'bold'}}>
                         {formatCurrency(personActuarial.vpaAportes - personActuarial.vpaBeneficios)}
                       </span>
                    </li>
                  </ul>
                </div>
                
                <div style={{flex: '1 1 500px', minHeight: '350px'}}>
                  <h4 style={{margin: '0 0 10px 0', color: '#475569', textAlign: 'center'}}>Evolución Vitalícia (Pasado vs Futuro)</h4>
                  <div style={{position: 'relative', height: '320px'}}>
                    <Line data={{
                      labels: personActuarial.labels,
                      datasets: [
                        {
                          label: 'Ingresos Históricos + Proyectados (Activo)',
                          data: personActuarial.ingresosActivos,
                          borderColor: '#3b82f6',
                          backgroundColor: '#3b82f6',
                          tension: 0.2,
                          borderWidth: 2,
                          pointRadius: 1,
                          spanGaps: true
                        },
                        {
                          label: 'Pensión Probable (Jubilado)',
                          data: personActuarial.ingresosPasivos,
                          borderColor: '#10b981',
                          backgroundColor: '#10b981',
                          tension: 0.2,
                          borderWidth: 3,
                          borderDash: [5, 5],
                          pointRadius: 1,
                          spanGaps: true
                        }
                      ]
                    }} options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        tooltip: {
                          callbacks: {
                            label: function(context) {
                              return context.dataset.label + ': ' + formatCurrency(context.raw);
                            }
                          }
                        }
                      },
                      scales: {
                        x: {
                          title: { display: true, text: 'Edad / Año', font: {weight: 'bold'} }
                        },
                        y: {
                          title: { display: true, text: 'Monto Anualizado (PYG)', font: {weight: 'bold'} },
                          ticks: {
                            callback: function(value) {
                              return new Intl.NumberFormat('es-PY', { notation: "compact", compactDisplay: "short" }).format(value);
                            }
                          }
                        }
                      }
                    }} />
                  </div>
                </div>
             </div>
          )}
        </div>

        <div style={{textAlign: 'center', marginBottom: '2rem', marginTop: '2rem'}}>
           <button className="btn-secondary" onClick={clearSearch}>Limpiar Búsqueda</button>
        </div>
      </>
    );
  };

  return (
    <div className="dashboard-container">
      {!ready && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <h2>Cargando Base de Datos Analítica (DuckDB WASM)</h2>
          <p style={{color: 'var(--text-muted)'}}>Descargando datos históricos comprimidos...</p>
        </div>
      )}
      
      <header>
        <h1>Transparencia Paraguay</h1>
        <p>Monitor Ciudadano de Funcionarios Públicos</p>
      </header>

      <div className="audit-banner">
        <strong>Lectura responsable:</strong> los paneles descriptivos muestran principalmente vínculos de pago y montos observados en la base histórica. Los escenarios de sostenibilidad e inferencias individuales son aproximaciones analíticas, no dictámenes administrativos ni actuariales definitivos.
      </div>

      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          Reportes Generales
        </button>
        <button 
          className={`tab-btn ${activeTab === 'particular' ? 'active' : ''}`}
          onClick={() => setActiveTab('particular')}
        >
          Reporte Particular (Por Cédula)
        </button>
        <button 
          className={`tab-btn ${activeTab === 'tir' ? 'active' : ''}`}
          onClick={() => setActiveTab('tir')}
        >
          Escenarios de Sostenibilidad
        </button>
        <button 
          className={`tab-btn ${activeTab === 'cotizantes' ? 'active' : ''}`}
          onClick={() => setActiveTab('cotizantes')}
        >
          📊 Estructura de Cotizantes
        </button>
      </div>

      <main>
        {activeTab === 'general' && renderGlobalCharts()}
        
        {activeTab === 'tir' && <CajaFiscalPanel globalData={globalData} />}

        {activeTab === 'cotizantes' && <CotizantesPanel db={db} />}
        
        {activeTab === 'particular' && (
          <>
            <section className="search-section">
              <h2>Consultar Funcionario</h2>
              <div className="search-box">
                <input 
                  type="text" 
                  inputMode="numeric" 
                  pattern="[0-9]*" 
                  className="search-input" 
                  placeholder="Ingrese Número de Cédula (Ej: 1000905)" 
                  value={cedulaInput}
                  onChange={(e) => setCedulaInput(sanitizeCedulaInput(e.target.value))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchClick()}
                />
                <button 
                  className="search-btn" 
                  onClick={handleSearchClick}
                  disabled={!ready || searching}
                >
                  {searching ? 'Buscando...' : 'Buscar'}
                </button>
              </div>
              {error && <div className="error-message">{error}</div>}
            </section>
            
            {renderIndividualCharts()}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
