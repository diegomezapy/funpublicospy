import { useState, useEffect } from 'react';
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

function App() {
  const [db, setDb] = useState(null);
  const [ready, setReady] = useState(false);
  const [cedulaInput, setCedulaInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // Estados visuales (Pestañas)
  const [activeTab, setActiveTab] = useState('general'); // 'general' | 'particular'
  
  // Datos Globales
  const [globalData, setGlobalData] = useState([]);
  
  // Filtros Globales
  const [filtroSexo, setFiltroSexo] = useState('Todos');
  const [filtroContrato, setFiltroContrato] = useState('Todos');
  // Datos Individuales
  const [personData, setPersonData] = useState([]);
  const [personKpis, setPersonKpis] = useState(null);

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
        await mydb.registerFileURL('totales.parquet', `${baseUrl}data_procesada/totales_historicos.parquet`, duckdb.DuckDBDataProtocol.HTTP, false);
        
        // Registrar Parquets por año (2015 a 2026)
        const anios = Array.from({length: 2026 - 2015 + 1}, (_, i) => 2015 + i);
        for (const anio of anios) {
          await mydb.registerFileURL(`nomina_${anio}.parquet`, `${baseUrl}data_procesada/nomina_${anio}.parquet`, duckdb.DuckDBDataProtocol.HTTP, false);
        }

        setDb(mydb);
        setReady(true);
        
        // Cargar vista global inicialmente
        await loadGlobalData(mydb, 'Todos', 'Todos');
      } catch (err) {
        console.error("Error inicializando db:", err);
        setError("Error cargando la base de datos.");
      }
    };
    initDb();
  }, []);

  useEffect(() => {
    if (db && ready) {
       loadGlobalData(db, filtroSexo, filtroContrato);
    }
  }, [filtroSexo, filtroContrato]);

  const loadGlobalData = async (database, s = filtroSexo, c = filtroContrato) => {
    const conn = await database.connect();
    try {
      let whereClauses = [];
      if (s !== 'Todos') whereClauses.push(`sexo_canon = '${s}'`);
      if (c !== 'Todos') whereClauses.push(`tipo_contrato = '${c}'`);
      
      const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

      // Leer el parquet hiper ligero agrupado globalmente
      const query = `
        SELECT anio, mes, gran_grupo, 
               CAST(SUM(monto_total_gastado) AS BIGINT) as monto_total_gastado, 
               CAST(SUM(cantidad_funcionarios_unicos) AS BIGINT) as cantidad_funcionarios_unicos,
               CAST(SUM(hombres) AS BIGINT) as hombres, CAST(SUM(mujeres) AS BIGINT) as mujeres,
               CAST(SUM(permanentes) AS BIGINT) as permanentes, CAST(SUM(contratados) AS BIGINT) as contratados
        FROM 'totales.parquet' 
        ${whereSQL}
        GROUP BY anio, mes, gran_grupo
        ORDER BY anio, mes
      `;
      const result = await conn.query(query);
      
      const rows = result.toArray().map(r => {
        const row = r.toJSON();
        for (let key in row) {
          if (typeof row[key] === 'bigint') {
            row[key] = Number(row[key]);
          }
        }
        return row;
      });
      setGlobalData(rows);
    } catch (err) {
      console.error(err);
      setError("Error cargando datos globales.");
    } finally {
      await conn.close();
    }
  };

  const handleSearchClick = async () => {
    if (!cedulaInput) return;
    setError('');
    setSearching(true);
    
    // Consultar DuckDB para esa cédula específica escaneando todos los Parquets Anuales
    const conn = await db.connect();
    try {
      // GLOB function de DuckDB o arreglo con pattern
      const query = `
        SELECT anio, mes, entidad_principal, monto_total_mes 
        FROM read_parquet('nomina_*.parquet') 
        WHERE cedula = '${cedulaInput}'
        ORDER BY anio, mes
      `;
      const result = await conn.query(query);
      const rows = result.toArray().map(r => {
        const row = r.toJSON();
        for (let key in row) {
          if (typeof row[key] === 'bigint') {
            row[key] = Number(row[key]);
          }
        }
        return row;
      });
      
      if (rows.length === 0) {
        setPersonData([]);
        setPersonKpis(null);
      } else {
        setPersonData(rows);
        
        // Calcular sus KPIs historicos
        let max_salario = 0;
        let sum_salarios = 0;
        let diff_promedio = 0; // Anomalía básica: Cuánto aumentó vs su primero
        
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

        setPersonKpis({
          max_salario,
          promedio: sum_salarios / rows.length,
          aumento_pct: aumento,
          entidad_actual: entidades_actuales
        });
      }
    } catch (err) {
      console.error(err);
      setError("Error buscando la cédula.");
    } finally {
      await conn.close();
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setCedulaInput('');
  };

  // =============== RENDERIZADOS DE GRÁFICOS ===============
  
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

    const dataGasto = {
      labels: uniqueLabels,
      datasets: datasetsGasto
    };

    const dataPromedio = {
      labels: uniqueLabels,
      datasets: datasetsPromedio
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
        <div className="kpi-grid">
           <div className="kpi-card">
              <span className="kpi-title">Funcionarios Último Mes</span>
              <span className="kpi-value">{new Intl.NumberFormat('es-PY').format(totalFunc)}</span>
           </div>
           <div className="kpi-card">
              <span className="kpi-title">Gasto Promedio per Cápita del Estado</span>
              <span className="kpi-value">{formatCurrency(avgState)}</span>
           </div>
        </div>

        <div className="filtros-panel" style={{display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1.5rem', flexWrap: 'wrap'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            <label style={{color: '#334155'}}><strong>Sexo:</strong></label>
            <select value={filtroSexo} onChange={(e) => setFiltroSexo(e.target.value)} style={{padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none'}}>
              <option value="Todos">Todos</option>
              <option value="Hombres">Hombres</option>
              <option value="Mujeres">Mujeres</option>
            </select>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            <label style={{color: '#334155'}}><strong>Vínculo:</strong></label>
            <select value={filtroContrato} onChange={(e) => setFiltroContrato(e.target.value)} style={{padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none'}}>
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
          <Line data={dataPromedio} options={{responsive: true, maintainAspectRatio: false}} />
        </div>

        <div className="chart-container">
          <h3 className="chart-title">Evolución Gasto Público Salarial Total (Apilado)</h3>
          <Bar data={dataGasto} options={{
             responsive: true, 
             maintainAspectRatio: false,
             scales: {
               x: { stacked: true },
               y: { stacked: true }
             }
          }} />
        </div>
        
        <div style={{display: 'flex', gap: '20px', flexWrap: 'wrap'}}>
          <div className="chart-container" style={{flex: 1, minWidth: '300px'}}>
            <h3 className="chart-title">Composición por Sexo (Último Mes)</h3>
            <Bar data={dataSexo} options={{
               responsive: true, 
               maintainAspectRatio: false,
               indexAxis: 'y', // Hacerlo horizontal para que se lean bien los grupos
               scales: {
                 x: { stacked: true },
                 y: { stacked: true }
               }
            }} />
          </div>
          <div className="chart-container" style={{flex: 1, minWidth: '300px'}}>
            <h3 className="chart-title">Composición por Contrato (Último Mes)</h3>
            <Bar data={dataContrato} options={{
               responsive: true, 
               maintainAspectRatio: false,
               indexAxis: 'y',
               scales: {
                 x: { stacked: true },
                 y: { stacked: true }
               }
            }} />
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
        </div>
        
        <div className="chart-container">
          <h3 className="chart-title">Evolución de Ingresos Cédula {cedulaInput}</h3>
          <Line data={dataSueldo} options={{responsive: true, maintainAspectRatio: false }} />
        </div>
        
        <div style={{textAlign: 'center', marginBottom: '2rem'}}>
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
      </div>

      <main>
        {activeTab === 'general' && renderGlobalCharts()}
        
        {activeTab === 'particular' && (
          <>
            <section className="search-section">
              <h2>Consultar Funcionario</h2>
              <div className="search-box">
                <input 
                  type="number" 
                  className="search-input" 
                  placeholder="Ingrese Número de Cédula (Ej: 1000905)" 
                  value={cedulaInput}
                  onChange={(e) => setCedulaInput(e.target.value)}
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
