import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
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
  const [tasaAporte, setTasaAporte] = useState(16);
  
  const [tirCalculada, setTirCalculada] = useState(null);
  const [diagnostico, setDiagnostico] = useState('');
  
  const [vpaAportes, setVpaAportes] = useState(0);
  const [vpaBeneficios, setVpaBeneficios] = useState(0);
  const [datosGraficoLinea, setDatosGraficoLinea] = useState(null);
  
  const formatMoney = (val) => new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(val);
  
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
    const crecNominal = parseFloat(crecimientoReal) + parseFloat(inflacion);
    const tasaDescuento = crecNominal; // Tasa de descuento base macroeconómica
    
    // Arrays de simulación
    let aportes = [];
    let beneficios = [];
    
    let edades = [];
    let ingresosActivo = [];
    let ingresosPasivo = [];
    let vpaAportesSum = 0;
    
    // 1. Array Salarios Anuales Proyectados
    let salarios = [];
    for(let t=0; t < añosAporte; t++){
        const sal = salarioBase * Math.pow((1 + crecNominal), t);
        salarios.push(sal);
        const aporteAnual = sal * (tasaAporte / 100);
        aportes.push(-aporteAnual); 
        
        edades.push(edadIngreso + t);
        ingresosActivo.push(sal * 13); // Aguinaldo
        ingresosPasivo.push(null);
        
        // VPA de aportes al momento de retiro: capitalizamos los aportes
        vpaAportesSum += aporteAnual * Math.pow((1 + tasaDescuento), añosAporte - t - 1);
    }
    
    // 2. Regulador (Últimos 5 años)
    const salarios_reg = salarios.slice(Math.max(salarios.length - 5, 0));
    const salario_regulador = salarios_reg.reduce((a, b) => a + b, 0) / salarios_reg.length;
    
    const beneficio_anual_base = salario_regulador * parseFloat(tasaSustitucion) * 13; // + Aguinaldo
    
    let vpaBeneficiosSum = 0;
    for(let t=0; t < esperanzaVida; t++){
        const beneficio = beneficio_anual_base * Math.pow((1 + parseFloat(inflacion)), t);
        beneficios.push(beneficio);
        
        edades.push(edadRetiro + t);
        ingresosActivo.push(null);
        ingresosPasivo.push(beneficio);
        
        // VPA de beneficios al momento de retiro: actualizamos hacia R
        vpaBeneficiosSum += beneficio / Math.pow((1 + tasaDescuento), t);
    }
    
    // Empalme visual para que el gráfico no se rompa abruptamente en el año de jubilación
    ingresosActivo[ingresosActivo.length - 1] = salarios[salarios.length - 1] * 13;
    ingresosPasivo[0] = beneficio_anual_base;

    const flujosVida = [...aportes, ...beneficios];
    
    const tir = calcularTIR(flujosVida);
    setTirCalculada(tir);
    setVpaAportes(vpaAportesSum);
    setVpaBeneficios(vpaBeneficiosSum);

    setDatosGraficoLinea({
      labels: edades.map(e => String(e)),
      datasets: [
        {
          label: 'Salario Anual Equivalente (Activo)',
          data: ingresosActivo,
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f6',
          borderWidth: 2,
          tension: 0.1,
          spanGaps: true
        },
        {
          label: 'Pensión Anual (Jubilado)',
          data: ingresosPasivo,
          borderColor: '#10b981',
          backgroundColor: '#10b981',
          borderWidth: 2,
          tension: 0.1,
          spanGaps: true
        }
      ]
    });
    
    // Evaluación Actuarial
    if(isNaN(tir)) {
        setDiagnostico("Los datos de esta simulación no permiten calcular una rentabilidad válida (Pérdida absoluta).");
    } else if (tir > crecNominal + 0.02) {
        setDiagnostico(`Subsidio Detectado: Estás recibiendo una ganancia anual del ${(tir*100).toFixed(1)}%. Esto es mucho mayor al crecimiento normal de la economía (${(crecNominal*100).toFixed(1)}%). El beneficio que recibes es pagado en parte con el dinero (impuestos/aportes) del resto de la ciudadanía.`);
    } else if (tir < crecNominal - 0.02) {
        setDiagnostico(`Pérdida de Ahorros: El beneficio que recibes es inferior a lo que crecería tu dinero normalmente. Estás subsidiando a los demás y perdiendo rendimiento.`);
    } else {
        setDiagnostico(`Sistema Justo y Equilibrado: Recibes exactamente lo correspondiente a tus años de aporte y al crecimiento esperado.`);
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
              return "Ganancia Indeterminada (Déficit / Depende full de Impuestos)";
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
        title: { display: true, text: 'Nivel de Ganancia (Rentabilidad) Obtenido sobre el Aporte (%)', font: {weight: 'bold'} },
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
        <h2 style={{color: '#0f172a'}}>¿Quién Paga Realmente las Jubilaciones? (Caja Fiscal)</h2>
        <p style={{color: '#64748b', maxWidth: '800px', margin: '0 auto'}}>
          Descubre si los funcionarios públicos reciben beneficios justos por lo que aportaron durante sus vidas, 
          o si están recibiendo súper-ganancias que se pagan quitándole dinero (impuestos o caja común) al resto de la ciudadanía.
        </p>
      </div>

      <div style={{display: 'flex', gap: '30px', flexWrap: 'wrap'}}>
        
        {/* Panel Interactivo Individual */}
        <div style={{flex: '1 1 400px', backgroundColor: '#f8fafc', padding: '25px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}>
          <h3 style={{marginTop: 0, color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px'}}>Calculadora Personal de Jubilación</h3>
          <p style={{fontSize: '0.85rem', color: '#64748b', marginBottom: '20px'}}>Prueba con distintos números de edad y salario para descubrir si en tu caso recibes un subsidio o sales perdiendo.</p>
          
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Edad al empezar a trabajar</label>
              <input type="number" value={edadIngreso} onChange={e => setEdadIngreso(Number(e.target.value))} style={{padding: '8px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Edad en la que te jubilas</label>
              <input type="number" value={edadRetiro} onChange={e => setEdadRetiro(Number(e.target.value))} style={{padding: '8px'}} />
            </div>
            
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Cuántos años vas a vivir jubilado</label>
              <input type="number" value={esperanzaVida} onChange={e => setEsperanzaVida(Number(e.target.value))} style={{padding: '8px'}} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Porcentaje de salario a cobrar</label>
              <select value={tasaSustitucion} onChange={e => setTasaSustitucion(Number(e.target.value))} style={{padding: '8px'}}>
                <option value={1.0}>100% (Administrativos)</option>
                <option value={0.93}>93% (Docentes)</option>
                <option value={0.6}>60% (Capitalización priv.)</option>
              </select>
            </div>
            
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Salario Inicial (PYG)</label>
              <input type="number" step="100000" value={salarioBase} onChange={e => setSalarioBase(Number(e.target.value))} style={{padding: '8px'}} />
            </div>

            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Crecimiento Real Economía</label>
              <input type="number" step="0.01" value={crecimientoReal} onChange={e => setCrecimientoReal(Number(e.target.value))} style={{padding: '8px'}} />
            </div>

            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Inflación Anual Esperada</label>
              <input type="number" step="0.01" value={inflacion} onChange={e => setInflacion(Number(e.target.value))} style={{padding: '8px'}} />
            </div>

            <div style={{display: 'flex', flexDirection: 'column'}}>
              <label style={{fontSize: '0.85rem', fontWeight: 'bold'}}>Tasa de Aporte (%)</label>
              <input type="number" step="0.5" value={tasaAporte} onChange={e => setTasaAporte(Number(e.target.value))} style={{padding: '8px'}} />
            </div>
          </div>
          
          <button onClick={handleCalcularTIR} style={{marginTop: '20px', width: '100%', padding: '12px', backgroundColor: '#0f172a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'}}>
            Calcular Equilibrio Actuarial
          </button>
          
          {tirCalculada !== null && (
            <div style={{marginTop: '25px', padding: '15px', border: '1px solid #cbd5e1', backgroundColor: 'white', borderRadius: '4px'}}>
              <h4 style={{margin: '0 0 10px 0', color: '#475569'}}>Resultado de la Comparación</h4>
              
              <div style={{display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px'}}>
                <span style={{fontSize: '2.5rem', fontWeight: 'bold', color: isNaN(tirCalculada) ? '#ef4444' : (tirCalculada > 0.1 ? '#f59e0b' : '#10b981')}}>
                  {isNaN(tirCalculada) ? "Error / Desmedido" : `${(tirCalculada * 100).toFixed(2)}%`}
                </span>
                <span style={{color: '#64748b'}}>Ganancia Anual de tu Jubilación</span>
              </div>
              
              <p style={{fontSize: '0.9rem', lineHeight: '1.5', margin: 0, paddingLeft: '10px', borderLeft: `4px solid ${isNaN(tirCalculada) ? '#ef4444' : '#f59e0b'}`, marginBottom: '15px'}}>
                <strong>Diagnóstico:</strong> {diagnostico}
              </p>

              {/* Valores Actuariales */}
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.9rem'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0'}}>
                  <span style={{color: '#64748b'}}>Valor Presente de tus Aportes:</span>
                  <strong style={{color: '#334155'}}>{formatMoney(vpaAportes)}</strong>
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', padding: '10px', backgroundColor: '#fcf8f8', borderRadius: '4px', border: '1px solid #fecdd3'}}>
                  <span style={{color: '#64748b'}}>Valor Presente de tus Beneficios:</span>
                  <strong style={{color: '#e11d48'}}>{formatMoney(vpaBeneficios)}</strong>
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', padding: '10px', backgroundColor: (vpaAportes - vpaBeneficios) >= 0 ? '#f0fdf4' : '#fef2f2', borderRadius: '4px', border: '1px solid ' + ((vpaAportes - vpaBeneficios) >= 0 ? '#bbf7d0' : '#fecaca')}}>
                  <span style={{color: '#475569', fontWeight: 'bold'}}>Balance (Déficit/Superávit):</span>
                  <strong style={{color: (vpaAportes - vpaBeneficios) >= 0 ? '#15803d' : '#b91c1c', fontSize: '1rem'}}>{formatMoney(vpaAportes - vpaBeneficios)}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panel Macro Gráfico */}
        <div style={{flex: '1 1 500px', display:'flex', flexDirection:'column'}}>
          <div style={{backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', flex: 1, minHeight: '400px'}}>
             <h3 style={{marginTop: 0, textAlign: 'center'}}>Radiografía de la Realidad Paraguaya (Datos 2011-2025)</h3>
             <p style={{fontSize: '0.85rem', color: '#64748b', textAlign: 'center'}}>Niveles de rentabilidad/ganancia demostrada que reciben las personas dependiendo de su gremio o sector.</p>
             
             <div style={{position: 'relative', height: '350px', width: '100%', marginTop: '20px'}}>
               <Bar data={dataEmpirica} options={chartOptions} />
             </div>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.85rem', color: '#64748b', padding: '15px', backgroundColor: '#f1f5f9', borderRadius: '4px'}}>
             <strong>¿Cómo interpretar este gráfico?</strong> Una ganancia o rentabilidad justa debiera reflejar la inflación del país más un pequeño premio (aproximadamente 6% a 8%). Los gremios militares y judiciales demuestran ganancias desmedidas que sobrepasan el enorme y exuberante límite del  <strong>+300% de ganancia extra por encima de su ahorro.</strong> Esos altísimos regalos y ganancias los termina avalando y pagando el Estado usando dinero y ahorro de la gente común, creando un círculo insostenible para el país.<br/><br/>Los sectores catalogados como "Indeterminado" indican que ni siquiera acumularon ahorros base (caja con plata) para financiarse, sino que ya arrancan con millonarios agujeros negros crónicos pagados con deudas de todos.
          </div>
        </div>

      </div>

      <div style={{marginTop: '30px', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0'}}>
        <h3 style={{marginTop: 0, textAlign: 'center'}}>Línea de Vida Financiera: Trabajar vs Jubilarse</h3>
        <p style={{fontSize: '0.85rem', color: '#64748b', textAlign: 'center'}}>Evolución de tus ingresos nominales esperados a lo largo del tiempo (Eje X: Edad).</p>
        <div style={{position: 'relative', height: '350px', width: '100%', marginTop: '20px'}}>
          {datosGraficoLinea && <Line data={datosGraficoLinea} options={{
             responsive: true,
             maintainAspectRatio: false,
             plugins: {
               tooltip: {
                 callbacks: {
                   label: function(context) {
                     return context.dataset.label + ': ' + formatMoney(context.raw);
                   }
                 }
               }
             },
             scales: {
               x: {
                 title: { display: true, text: 'Edad del Funcionario', font: {weight: 'bold'} }
               },
               y: {
                 title: { display: true, text: 'Ingresos Anuales (PYG)', font: {weight: 'bold'} },
                 ticks: {
                   callback: function(value) {
                     return new Intl.NumberFormat('es-PY', { notation: "compact", compactDisplay: "short" }).format(value);
                   }
                 }
               }
             }
          }} />}
        </div>
      </div>
    </div>
  );
};

export default CajaFiscalPanel;
