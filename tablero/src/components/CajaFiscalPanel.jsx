import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const CajaFiscalPanel = () => {
  // Estados Calculadora Individual "Newton-Raphson" Ported.
  const [edadIngreso, setEdadIngreso] = useState(25);
  const [edadRetiro, setEdadRetiro] = useState(65);
  const [esperanzaVida, setEsperanzaVida] = useState(15);
  const [tasaSustitucion, setTasaSustitucion] = useState(1.0);
  const [crecimientoReal, setCrecimientoReal] = useState(0.02);
  const [inflacion, setInflacion] = useState(0.04);
  const [salarioBase, setSalarioBase] = useState(3000000);
  
  const [tirCalculada, setTirCalculada] = useState(null);
  const [diagnostico, setDiagnostico] = useState('');
  
  // Implementación recursiva nativa JS de Newton-Raphson para VNA=0
  const calcularTIR = (flujos) => {
    let guess = 0.05;
    const max_iter = 1000;
    const tol = 1e-6;

    const vpn = (r) => flujos.reduce((acc, f, t) => acc + f / Math.pow(1 + r, t), 0);
    const vpnDerivada = (r) => flujos.reduce((acc, f, t) => {
      // Evitar derivadas en t=0 que daría Math.pow(x, -1) para evitar infinitys raros
      if (t === 0) return acc; 
      return acc - t * f / Math.pow(1 + r, t + 1);
    }, 0);

    for (let i = 0; i < max_iter; i++) {
      const g_t = vpn(guess);
      const g_t_prime = vpnDerivada(guess);
      if (Math.abs(g_t_prime) < Number.EPSILON) break; // Div by zero prevent
      
      const next_guess = guess - g_t / g_t_prime;
      if (Math.abs(next_guess - guess) < tol) return next_guess;
      guess = next_guess;
    }
    return NaN; // No convegencia o raíces imaginarias
  };

  const handleCalcularTIR = () => {
    const añosAporte = edadRetiro - edadIngreso;
    
    // Arrays de simulación
    let aportes = [];
    let beneficios = [];
    
    // 1. Array Salarios Anuales Proyectados
    let salarios = [];
    for(let t=0; t < añosAporte; t++){
        const sal = salarioBase * Math.pow((1 + parseFloat(crecimientoReal) + parseFloat(inflacion)), t);
        salarios.push(sal);
        aportes.push(-(sal * 0.16)); // El funcionario aporta el 16% de todos sus salarios percibidos
    }
    
    // 2. Regulador (Últimos 5 años)
    const salarios_reg = salarios.slice(Math.max(salarios.length - 5, 0));
    const salario_regulador = salarios_reg.reduce((a, b) => a + b, 0) / salarios_reg.length;
    
    const beneficio_anual_base = salario_regulador * parseFloat(tasaSustitucion) * 13; // + Aguinaldo
    
    for(let t=0; t < esperanzaVida; t++){
        beneficios.push(beneficio_anual_base * Math.pow((1 + parseFloat(inflacion)), t));
    }
    
    const flujosVida = [...aportes, ...beneficios];
    
    const tir = calcularTIR(flujosVida);
    setTirCalculada(tir);
    
    // Evaluación Actuarial
    const crecNominal = parseFloat(crecimientoReal) + parseFloat(inflacion);
    if(isNaN(tir)) {
        setDiagnostico("La dinámica de flujos no permite converger una TIR (Pérdida Crónica Absoluta o Error).");
    } else if (tir > crecNominal + 0.02) {
        setDiagnostico(`Subsidio Activo Detectado. La rentabilidad absorbida del sistema (${(tir*100).toFixed(1)}%) supera excesivamente al crecimiento orgánico de la riqueza de la economía (${(crecNominal*100).toFixed(1)}%). Esta persona extrae capital ajeno (impuestos o del resto de trabajadores).`);
    } else if (tir < crecNominal - 0.02) {
        setDiagnostico(`Confiscatorio. La tasa implícita que entrega el sistema es inferior a la tasa que rinde la economía real, el sistema licúa ahorros en esta cohorte.`);
    } else {
        setDiagnostico(`Actuarialmente Equilibrado (Samuelson-Aaron Limit). El sistema devuelve el peso exacto del ahorro acumulado considerando las tasas de crecimiento orgánicas.`);
    }
  };

  useEffect(() => {
    handleCalcularTIR();
  // eslint-disable-next-line
  }, []); // Run on mount

  // Datos Empíricos Reales de la Caja Fiscal Histórica 2011-2025 parseados directamente de Python
  const dataEmpirica = {
    labels: [
       'Fuerzas Armadas', 
       'Magistrados', 
       'Caja Global Consolidada', 
       'Docentes Universitarios',
       'Admin. Pública', 
       'Magisterio', 
       'Policía'
    ],
    datasets: [
      {
        label: 'Tasa Implícita de Retorno Real (%)',
        data: [349.81, 339.26, 44.81, -4.93, -50, -50, -50], // -50 representa Perdida Pura Incalculable
        backgroundColor: [
          '#ff7f0e', // Naranja/Rojo hiper rentabilidad
          '#ff7f0e', 
          '#1f77b4', // Global Azul
          '#d62728', // Negativo
          '#d62728', // Indeterminado (Déficit Base)
          '#d62728',
          '#d62728'
        ],
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y', // Bar chart horizontal
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if(context.raw === -50) {
              return "TIR Indeterminada (Déficit Perpetuo desde Base Cero)";
            }
            if (context.parsed.x !== null) {
              label += context.parsed.x.toFixed(1) + '%';
            }
            return label;
          }
        }
      }
    },
    scales: {
      x: {
        title: { display: true, text: 'Rentabilidad Financiera Extraída de la Caja (%)', font: {weight: 'bold'} },
        min: -60,
        ticks: {
          callback: function(value) {
            if(value === -50) return "Indeterminado";
            return value + '%';
          }
        }
      },
      y: {
        title: { display: true, text: 'Programa Previsional', font: {weight: 'bold'} }
      }
    }
  };

  return (
    <div className="dashboard-container" style={{maxWidth: '1200px', margin: '0 auto', padding: '20px'}}>
      
      <div style={{textAlign: 'center', marginBottom: '40px'}}>
        <h2 style={{color: '#0f172a'}}>Estudio Actuarial de la Seguridad Social Paraguaya (Caja Fiscal)</h2>
        <p style={{color: '#64748b', maxWidth: '800px', margin: '0 auto'}}>
          Este módulo cuantifica algorítmicamente el desbalance financiero subyacente a las promesas de reparto estatal. 
          Utiliza la ecuación de equivalencia de Newton-Raphson para despejar la "Tasa Implícita de Retorno (TIR)" del aportante frente al estado.
        </p>
      </div>

      <div style={{display: 'flex', gap: '30px', flexWrap: 'wrap'}}>
        
        {/* Panel Interactivo Individual */}
        <div style={{flex: '1 1 400px', backgroundColor: '#f8fafc', padding: '25px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}>
          <h3 style={{marginTop: 0, color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px'}}>Calculadora Actuarial de Subsidos (Cohortes)</h3>
          <p style={{fontSize: '0.85rem', color: '#64748b', marginBottom: '20px'}}>Modifica los umbrales de trabajo de un funcionario para ver cómo alteran el costo sistémico.</p>
          
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Edad Inicial de Aporte</label>
              <input type="number" value={edadIngreso} onChange={e => setEdadIngreso(Number(e.target.value))} style={{padding: '8px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Edad de Jubilación</label>
              <input type="number" value={edadRetiro} onChange={e => setEdadRetiro(Number(e.target.value))} style={{padding: '8px'}} />
            </div>
            
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Años de Vida tras Retiro</label>
              <input type="number" value={esperanzaVida} onChange={e => setEsperanzaVida(Number(e.target.value))} style={{padding: '8px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Tasa de Sustitución Prometida</label>
              <select value={tasaSustitucion} onChange={e => setTasaSustitucion(Number(e.target.value))} style={{padding: '8px'}}>
                <option value={1.0}>100% Promedio</option>
                <option value={0.93}>93% Extraordinario</option>
                <option value={0.6}>60% Capitalización</option>
              </select>
            </div>
          </div>
          
          <button onClick={handleCalcularTIR} style={{marginTop: '20px', width: '100%', padding: '12px', backgroundColor: '#0f172a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'}}>
            Calcular Equilibrio Actuarial
          </button>
          
          {tirCalculada !== null && (
            <div style={{marginTop: '25px', padding: '15px', border: '1px solid #cbd5e1', backgroundColor: 'white', borderRadius: '4px'}}>
              <h4 style={{margin: '0 0 10px 0', color: '#475569'}}>Resultado de la Tasa Interna de Retorno</h4>
              
              <div style={{display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px'}}>
                <span style={{fontSize: '2.5rem', fontWeight: 'bold', color: isNaN(tirCalculada) ? '#ef4444' : (tirCalculada > 0.1 ? '#f59e0b' : '#10b981')}}>
                  {isNaN(tirCalculada) ? "Indet." : `${(tirCalculada * 100).toFixed(2)}%`}
                </span>
                <span style={{color: '#64748b'}}>TIR Anual Implícita</span>
              </div>
              
              <p style={{fontSize: '0.9rem', lineHeight: '1.5', margin: 0, paddingLeft: '10px', borderLeft: `4px solid ${isNaN(tirCalculada) ? '#ef4444' : '#f59e0b'}`}}>
                <strong>Diagnóstico:</strong> {diagnostico}
              </p>
            </div>
          )}
        </div>

        {/* Panel Macro Gráfico */}
        <div style={{flex: '1 1 500px', display:'flex', flexDirection:'column'}}>
          <div style={{backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', flex: 1, minHeight: '400px'}}>
             <h3 style={{marginTop: 0, textAlign: 'center'}}>Resultados Históricos Puros (Dataset Caja Fiscal 2011-2025)</h3>
             <p style={{fontSize: '0.85rem', color: '#64748b', textAlign: 'center'}}>Observación empírica de flujos reales de ingresos vs egresos por programa.</p>
             
             <div style={{position: 'relative', height: '350px', width: '100%', marginTop: '20px'}}>
               <Bar data={dataEmpirica} options={chartOptions} />
             </div>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.85rem', color: '#64748b', padding: '15px', backgroundColor: '#f1f5f9', borderRadius: '4px'}}>
             <strong>Contexto Actuarial:</strong> Un programa o seguro equilibrado que no estafa intergeneracionalmente debería tener una TIR cercana a la tasa natural de crecimiento y dividendo de la economía (aprox 6%-8% global para PY). Rentabilidades empíricas del +300% demuestran la extracción parasitaria de recursos ajenos. Los sectores mostrados como "Indeterminados" están en la vereda opuesta: han dependido 100% de subsidios generales ajenos, fallando el requisito de equivalencia matemática financiera para computarse como autárquicos.
          </div>
        </div>

      </div>
    </div>
  );
};

export default CajaFiscalPanel;
