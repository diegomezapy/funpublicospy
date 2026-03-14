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
        await mydb.registerFileURL('nomina.parquet', `${baseUrl}data_procesada/nomina_completa_optimizada.parquet`, duckdb.DuckDBDataProtocol.HTTP, false);

        setDb(mydb);
        setReady(true);
        
        // Cargar vista global inicialmente
        await loadGlobalData(mydb);
      } catch (err) {
        console.error("Error inicializando db:", err);
        setError("Error cargando la base de datos.");
      }
    };
    initDb();
  }, []);

  const loadGlobalData = async (database) => {
    const conn = await database.connect();
    try {
      // Leer el parquet hiper ligero agrupado globalmente
      const query = `
        SELECT anio, mes, monto_total_gastado, monto_promedio, cantidad_funcionarios_unicos 
        FROM 'totales.parquet' 
        ORDER BY anio, mes
      `;
      const result = await conn.query(query);
      
      const rows = result.toArray().map(r => r.toJSON());
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
    
    // Consultar DuckDB para esa cédula específica
    const conn = await db.connect();
    try {
      // Nota: cedula es CAST(string) en parquet
      const query = `
        SELECT anio, mes, entidad_principal, monto_total_mes 
        FROM 'nomina.parquet' 
        WHERE cedula = '${cedulaInput}'
        ORDER BY anio, mes
      `;
      const result = await conn.query(query);
      const rows = result.toArray().map(r => r.toJSON());
      
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
        
        setPersonKpis({
          max_salario,
          promedio: sum_salarios / rows.length,
          aumento_pct: aumento,
          entidad_actual: rows[rows.length - 1].entidad_principal
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
    if (globalData.length === 0) return null;
    
    const labels = globalData.map(d => `${d.anio}-${String(d.mes).padStart(2,'0')}`);
    const gastoTotal = globalData.map(d => d.monto_total_gastado);
    const salariosMedios = globalData.map(d => d.monto_promedio);
    const funcionarios = globalData.map(d => d.cantidad_funcionarios_unicos);
    
    const dataGasto = {
      labels,
      datasets: [
        {
          label: 'Gasto Total del Estado (Gs)',
          data: gastoTotal,
          backgroundColor: 'rgba(79, 70, 229, 0.6)',
        }
      ]
    };

    const dataPromedio = {
      labels,
      datasets: [
        {
          label: 'Sueldo Promedio (Gs)',
          data: salariosMedios,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.2)',
          fill: true,
          tension: 0.4
        }
      ]
    };

    return (
      <>
        <div className="kpi-grid">
           <div className="kpi-card">
              <span className="kpi-title">Funcionarios Último Mes</span>
              <span className="kpi-value">{new Intl.NumberFormat('es-PY').format(funcionarios[funcionarios.length-1])}</span>
           </div>
           <div className="kpi-card">
              <span className="kpi-title">Sueldo Promedio del Estado</span>
              <span className="kpi-value">{formatCurrency(salariosMedios[salariosMedios.length-1] || 0)}</span>
           </div>
        </div>
        <div className="chart-container">
          <h3 className="chart-title">Evolución Gasto Público Salarial</h3>
          <Bar data={dataGasto} options={{responsive: true, maintainAspectRatio: false }} />
        </div>
        <div className="chart-container">
          <h3 className="chart-title">Evolución Sueldo Promedio</h3>
          <Line data={dataPromedio} options={{responsive: true, maintainAspectRatio: false}} />
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
    
    const labels = personData.map(d => `${d.anio}-${String(d.mes).padStart(2,'0')}`);
    const sueldos = personData.map(d => d.monto_total_mes);
    
    const dataSueldo = {
      labels,
      datasets: [
        {
          label: 'Ingreso Total (Sueldo + Extras) (Gs)',
          data: sueldos,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.2)',
          fill: true,
          pointRadius: 4,
          tension: 0.1
        }
      ]
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
