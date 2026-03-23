import React, { useState, useMemo, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const SimuladorPensionPanel = ({ personData, personKpis, cedula }) => {
  // Input states
  const [anioNacimiento, setAnioNacimiento] = useState(1980);
  const [anioInicioAportes, setAnioInicioAportes] = useState(2005);
  const [esperanzaVida, setEsperanzaVida] = useState(15);
  const [tasaAporteActual, setTasaAporteActual] = useState(16);
  const [tasaAporteNueva, setTasaAporteNueva] = useState(16);
  const [anioReforma, setAnioReforma] = useState(2027);
  const [tasaSustitucion, setTasaSustitucion] = useState(1.0);
  
  // Novedades desde R
  const [inflationRate, setInflationRate] = useState(4);
  const [yearsToUpdate, setYearsToUpdate] = useState(5);
  const [useCpi, setUseCpi] = useState(true);
  const [useMinWage, setUseMinWage] = useState(false);
  const [realSmlIncrease, setRealSmlIncrease] = useState(1);
  const [averagingPeriod, setAveragingPeriod] = useState(5);
  const [actuarialRate, setActuarialRate] = useState(5);

  useEffect(() => {
    if (personKpis?.anio_nacim) {
      setAnioNacimiento(personKpis.anio_nacim);
    }
    if (personData?.length > 0) {
      setAnioInicioAportes(Math.min(...personData.map(d => d.anio)));
    }
  }, [personData, personKpis]);

  const sim = useMemo(() => {
    if (!personData || personData.length === 0) return null;

    const infRate = inflationRate / 100;
    const actRate = actuarialRate / 100;
    const smlRate = useMinWage ? (realSmlIncrease / 100) : 0;

    let histPorAnio = {};
    personData.forEach(d => {
       if(!histPorAnio[d.anio]) histPorAnio[d.anio] = 0;
       histPorAnio[d.anio] += d.monto_total_mes;
    });

    const añosReales = Object.keys(histPorAnio).map(Number).sort();
    const primerAnio = añosReales[0];
    const ultimoAnio = añosReales[añosReales.length - 1];

    const mesesUltimoAnio = personData.filter(d => d.anio === ultimoAnio).length;
    if (mesesUltimoAnio > 0 && mesesUltimoAnio < 12) {
       histPorAnio[ultimoAnio] = (histPorAnio[ultimoAnio] / mesesUltimoAnio) * 13;
    }

    const anioRetiroPorEdad = anioNacimiento + 62;
    const anioRetiroPorAntiguedad = anioInicioAportes + 20;
    const anioRetiro = Math.max(anioRetiroPorEdad, anioRetiroPorAntiguedad);

    const anioMuerte = anioRetiro + esperanzaVida;
    
    // Regresión lineal para proyectar salarios
    const nSeries = añosReales.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    añosReales.forEach(a => {
       const x = a - primerAnio;
       const y = histPorAnio[a];
       sumX += x; sumY += y; sumXY += (x * y); sumX2 += (x * x);
    });
    let slope = 0, intercept = histPorAnio[ultimoAnio] || 0;
    if (nSeries > 1) {
       slope = (nSeries * sumXY - sumX * sumY) / (nSeries * sumX2 - sumX * sumX);
       intercept = (sumY - slope * sumX) / nSeries;
    }
    if (slope < 0) slope = 0;

    // Array completo de años (desde primerAnio hasta anioMuerte)
    const añosFull = Array.from({length: anioMuerte - primerAnio + 1}, (_, i) => primerAnio + i);
    const numYears = añosFull.length;
    let salaries = Array(numYears).fill(null);

    let ultimoSueldoAnual = histPorAnio[ultimoAnio] || 0;

    for (let i = 0; i < numYears; i++) {
        const a = añosFull[i];
        if (a <= ultimoAnio) {
            salaries[i] = histPorAnio[a] || 0;
        } else if (a <= anioRetiro) {
            let forecastLineal = slope * (a - primerAnio) + intercept;
            let minimoInflacionario = ultimoSueldoAnual * (1 + infRate);
            ultimoSueldoAnual = Math.max(forecastLineal, minimoInflacionario);
            salaries[i] = ultimoSueldoAnual;
        }
    }

    const currentYear = 2026;
    
    const cumulativeInflation = añosFull.map(a => Math.pow(1 + infRate, Math.max(0, a - currentYear)));
    const realSalaries = salaries.map((sal, i) => sal !== null ? sal / cumulativeInflation[i] : null);

    const retirementIdx = añosFull.findIndex(a => a >= anioRetiro);
    const safeRetirementIdx = retirementIdx >= 0 ? retirementIdx : (numYears - 1);

    // Revalorización Salarial R
    let updateRate = 0;
    let formulaText = "Sin actualización";
    if (useCpi && useMinWage) {
      updateRate = (1 + infRate) * (1 + smlRate) - 1;
      formulaText = `Factor de Actualización: [(1 + ${(infRate*100).toFixed(1)}%) × (1 + ${(smlRate*100).toFixed(1)}%)]^n - 1`;
    } else if (useCpi) {
      updateRate = infRate;
      formulaText = `Factor de Actualización: (1 + ${(infRate*100).toFixed(1)}%)^n`;
    } else if (useMinWage) {
      updateRate = smlRate;
      formulaText = `Factor de Actualización: (1 + ${(smlRate*100).toFixed(1)}%)^n`;
    }

    let revaluedSalaries = [...salaries];
    const revalStartIdx = Math.max(safeRetirementIdx - averagingPeriod, 0);
    const revalEndIdx = safeRetirementIdx - 1;
    
    if (updateRate !== 0 && revalStartIdx <= revalEndIdx && revalEndIdx >= 0) {
      for (let i = revalStartIdx; i <= revalEndIdx; i++) {
        const yrsToRet = anioRetiro - añosFull[i];
        const reFactor = Math.pow(1 + updateRate, yrsToRet);
        revaluedSalaries[i] = salaries[i] * reFactor;
      }
    }

    // Beneficios Pensiones
    const avgSalaryStartIdx = Math.max(safeRetirementIdx - averagingPeriod, 0);
    const avgUpdatedPeriod = revaluedSalaries.slice(avgSalaryStartIdx, safeRetirementIdx);
    const avgOriginalPeriod = salaries.slice(avgSalaryStartIdx, safeRetirementIdx);

    const avgUpdated = avgUpdatedPeriod.length > 0 ? (avgUpdatedPeriod.reduce((a,b)=>a+b,0)/avgUpdatedPeriod.length) : (salaries[safeRetirementIdx-1] || 0);
    const avgOriginal = avgOriginalPeriod.length > 0 ? (avgOriginalPeriod.reduce((a,b)=>a+b,0)/avgOriginalPeriod.length) : (salaries[safeRetirementIdx-1] || 0);

    const pensionBenefitNominal = avgUpdated * tasaSustitucion;
    const pensionNoUpdate = avgOriginal * tasaSustitucion;

    const numPensionYears = anioMuerte - anioRetiro;
    const pensionBenefitsNominal = Array(numPensionYears).fill(0).map((_, i) => pensionBenefitNominal * Math.pow(1 + infRate, i));
    const pensionBenefitsReal = pensionBenefitsNominal.map((p, i) => p / cumulativeInflation[Math.min(safeRetirementIdx + 1 + i, cumulativeInflation.length-1)]);

    // Vectores para gráfico
    const contribFull = Array(numYears).fill(null);
    let totalVPContrib = 0;
    
    for (let i = 0; i <= safeRetirementIdx; i++) {
        const tasaAporte = añosFull[i] >= anioReforma ? (tasaAporteNueva / 100) : (tasaAporteActual / 100);
        const c = salaries[i] * tasaAporte;
        contribFull[i] = c;
        totalVPContrib += c / Math.pow(1 + actRate, Math.max(0, añosFull[i] - currentYear));
    }

    const pensionNominalFull = Array(numYears).fill(null);
    const pensionRealFull = Array(numYears).fill(null);
    let totalVPBen = 0;

    for (let i = 0; i < numPensionYears; i++) {
        const curIdx = safeRetirementIdx + 1 + i;
        if(curIdx < numYears) {
          pensionNominalFull[curIdx] = pensionBenefitsNominal[i];
          pensionRealFull[curIdx] = pensionBenefitsReal[i];
          totalVPBen += pensionBenefitsNominal[i] / Math.pow(1 + actRate, añosFull[curIdx] - currentYear);
        }
    }

    // Fill NAs correctly
    const salariesNominalFull = salaries.map((v, i) => i <= safeRetirementIdx ? v : null);
    const salariesRealFull = realSalaries.map((v, i) => i <= safeRetirementIdx ? v : null);
    const salariesRevFull = revaluedSalaries.map((v, i) => i <= safeRetirementIdx && i >= revalStartIdx ? v : (i<=safeRetirementIdx? salaries[i]: null));

    const tasaImplicita = totalVPContrib !== 0 ? totalVPBen / totalVPContrib : null;

    return {
        añosFull, salariesNominalFull, salariesRealFull, salariesRevFull, 
        contribFull, pensionNominalFull, pensionRealFull,
        pensionNoUpdate, pensionBenefitNominal, totalVPContrib, totalVPBen, tasaImplicita, formulaText,
        anioRetiro, edadAlRetiro: anioRetiro - anioNacimiento, antiguedadAlRetiro: anioRetiro - anioInicioAportes
    };
  }, [personData, anioNacimiento, anioInicioAportes, esperanzaVida, tasaAporteActual, tasaAporteNueva, anioReforma, tasaSustitucion, inflationRate, yearsToUpdate, useCpi, useMinWage, realSmlIncrease, averagingPeriod, actuarialRate]);

  if (!personData || personData.length === 0) return null;

  const chartData = sim ? {
    labels: sim.añosFull,
    datasets: [
      {
        label: 'Salario Nominal (Histórico + Proyectado)',
        data: sim.salariesNominalFull,
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        pointRadius: 1
      },
      {
        label: 'Salario Real',
        data: sim.salariesRealFull,
        borderColor: 'rgba(59, 130, 246, 0.8)',
        borderWidth: 2,
        borderDash: [5, 5],
        fill: false,
        tension: 0.1,
        pointRadius: 0
      },
      {
        label: 'Salario Revalorizado',
        data: sim.salariesRevFull,
        borderColor: 'rgba(168, 85, 247, 1)',
        borderWidth: 2,
        borderDash: [2, 2],
        fill: false,
        tension: 0.1,
        pointRadius: 0
      },
      {
        label: 'Aportes al Estado',
        data: sim.contribFull,
        borderColor: 'rgba(249, 115, 22, 1)',
        borderWidth: 2,
        fill: false,
        tension: 0.1,
        pointRadius: 0
      },
      {
        label: 'Pensión Nominal Estimada',
        data: sim.pensionNominalFull,
        borderColor: 'rgba(34, 197, 94, 1)',
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        pointRadius: 1
      },
      {
        label: 'Pensión Real',
        data: sim.pensionRealFull,
        borderColor: 'rgba(21, 128, 61, 1)',
        borderWidth: 2,
        borderDash: [5,5],
        fill: false,
        tension: 0.1,
        pointRadius: 0
      }
    ]
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD', maximumFractionDigits:0 }).format(ctx.raw)}`
        }
      }
    },
    scales: {
      x: { title: { display: true, text: 'Año' } },
      y: { 
        title: { display: true, text: 'Ingresos / Contribuciones (PYG)' },
        ticks: { callback: function(value) { return new Intl.NumberFormat('es-PY', { notation: "compact", compactDisplay: "short" }).format(value); } }
      }
    }
  };

  const formatCurrency = (val) => new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(val);

  return (
    <div style={{ marginTop: '30px', backgroundColor: '#f8fafc', padding: '25px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
      <h3 style={{ marginTop: 0, color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>Estudio Actuarial Personalizado Cédula {cedula}</h3>
      <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '20px' }}>Esta proyección combina su historia salarial devengada real y la proyecta hasta su retiro utilizando modelos actuariales dinámicos. Permite alterar parámetros de revalorización e inflación e independiza el valor de contribuciones pasadas frente a retornos futuros.</p>
      
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        
        {/* PANEL IZQUIERDO: Configuración */}
        <div style={{ flex: '1 1 350px', backgroundColor: '#ffffff', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            
            <h4 style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '10px', marginTop: 0, color:'#475569' }}>Parámetros Biográficos</h4>
            <div className="input-group">
                <label>Año de Nacimiento:</label>
                <input type="range" min="1940" max="2005" value={anioNacimiento} onChange={e=>setAnioNacimiento(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{anioNacimiento}</span>
            </div>
            <div className="input-group">
                <label>Año de Inicio de Aportes:</label>
                <input type="range" min="1970" max="2025" value={anioInicioAportes} onChange={e=>setAnioInicioAportes(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{anioInicioAportes}</span>
            </div>

            <h4 style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '10px', marginTop: '20px', color:'#475569' }}>Proyección Macroeconómica</h4>
            <div className="input-group">
                <label>Inflación General Anual Promedio (%):</label>
                <input type="range" min="0" max="15" step="0.5" value={inflationRate} onChange={e=>setInflationRate(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{inflationRate}%</span>
            </div>
            <div className="input-group">
                <label>Tasa Actuarial de Descuento (Valor del Dinero %):</label>
                <input type="range" min="1" max="15" step="0.5" value={actuarialRate} onChange={e=>setActuarialRate(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{actuarialRate}%</span>
            </div>

            <h4 style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '10px', marginTop: '20px', color:'#475569' }}>Políticas Jubilatorias</h4>
            <div className="input-group">
                <label>Esperanza de Vida Post-Retiro (Años Cobrando):</label>
                <input type="range" min="5" max="35" value={esperanzaVida} onChange={e=>setEsperanzaVida(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{esperanzaVida} años</span>
            </div>
            <div className="input-group">
                <label>Porcentaje de Aporte Mensual (Actual %):</label>
                <input type="range" min="5" max="30" step="0.5" value={tasaAporteActual} onChange={e=>setTasaAporteActual(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{tasaAporteActual}%</span>
            </div>
            <div className="input-group">
                <label>Tasa de Sustitución Prometida:</label>
                <select value={tasaSustitucion} onChange={e=>setTasaSustitucion(Number(e.target.value))} style={{width:'100%', padding:'5px'}}>
                    <option value={1.0}>100% — Administrativos / Policías</option>
                    <option value={0.93}>93% — Docentes</option>
                    <option value={0.80}>80% — Base general recomendada</option>
                    <option value={0.60}>60% — Capitalización / Escenario Adverso</option>
                </select>
            </div>
            
            <h4 style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '10px', marginTop: '20px', color:'#475569' }}>Fórmula de Revalorización</h4>
            <div className="input-group">
                <label>Periodo para Promediar (Últimos X Años):</label>
                <input type="range" min="1" max="10" value={averagingPeriod} onChange={e=>setAveragingPeriod(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{averagingPeriod} años ({averagingPeriod*12} meses)</span>
            </div>
            <div className="input-group">
                <label>Años a Actualizar/Revalorizar Base:</label>
                <input type="range" min="0" max="15" value={yearsToUpdate} onChange={e=>setYearsToUpdate(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{yearsToUpdate} previos al retiro</span>
            </div>
            <div className="input-group" style={{marginTop: '10px'}}>
                <label><input type="checkbox" checked={useCpi} onChange={e=>setUseCpi(e.target.checked)}/> Actualizar Base con Inflación</label>
            </div>
            <div className="input-group">
                <label><input type="checkbox" checked={useMinWage} onChange={e=>setUseMinWage(e.target.checked)}/> Aumento Real del Estándar</label>
            </div>
            {useMinWage && (
                <div className="input-group">
                    <label>Incremento Real Extra (%):</label>
                    <input type="range" min="0" max="5" step="0.1" value={realSmlIncrease} onChange={e=>setRealSmlIncrease(Number(e.target.value))} style={{width:'100%'}}/>
                    <span>{realSmlIncrease}%</span>
                </div>
            )}
        </div>

        {/* PANEL DERECHO: Gráficos e Indicadores */}
        <div style={{ flex: '1 1 600px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {sim && (
            <div style={{backgroundColor: '#eff6ff', borderLeft: '4px solid #3b82f6', padding: '15px', borderRadius: '4px'}}>
               <h5 style={{margin: '0 0 5px 0', color: '#1e3a8a', fontSize: '1.05rem'}}>Proyección Básica</h5>
               <p style={{margin: 0, fontSize: '0.9rem', color: '#334155'}}>Alcanzarás los requisitos de edad/antigüedad en el <strong>año {sim.anioRetiro}</strong> (Edad: {sim.edadAlRetiro} años, Antigüedad: {sim.antiguedadAlRetiro} años).</p>
            </div>
            )}

            <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '15px', height: '400px' }}>
                {sim && <Line data={chartData} options={chartOptions} />}
            </div>

            {sim && (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '15px' }}>
                <h3 style={{ borderBottom: '2px solid #cbd5e1', paddingBottom: '10px', marginTop: 0, color:'#475569' }}>Diagnóstico de Equilibrio Financiero</h3>
                
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '10px', marginBottom: '15px' }}>
                    <span style={{fontSize: '0.85rem', color: '#166534', fontWeight: 'bold'}}>Fórmula Aplicada a Base Promedio: </span>
                    <span style={{fontSize: '0.85rem', color: '#15803d'}}>{sim.formulaText}</span>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize:'0.95rem' }}>
                    <tbody>
                        <tr style={{borderBottom: '1px solid #f1f5f9'}}>
                            <td style={{padding: '8px 0'}}>Monto Inicial de Pensión Nominal Prometido</td>
                            <td style={{padding: '8px 0', fontWeight: 'bold', textAlign:'right'}}>{formatCurrency(sim.pensionBenefitNominal)}</td>
                        </tr>
                        <tr style={{borderBottom: '1px solid #f1f5f9'}}>
                            <td style={{padding: '8px 0'}}>Valor Presente de Contribuciones Pagadas (Aportes PVC)</td>
                            <td style={{padding: '8px 0', fontWeight: 'bold', color: '#ea580c', textAlign:'right'}}>{formatCurrency(sim.totalVPContrib)}</td>
                        </tr>
                        <tr style={{borderBottom: '2px solid #cbd5e1'}}>
                            <td style={{padding: '8px 0'}}>Valor Presente de Subsidio Vitalicio (Beneficios VPBF)</td>
                            <td style={{padding: '8px 0', fontWeight: 'bold', color: '#16a34a', textAlign:'right'}}>{formatCurrency(sim.totalVPBen)}</td>
                        </tr>
                        <tr>
                            <td style={{padding: '12px 0', fontSize: '1.05rem', fontWeight:'bold', color: (sim.totalVPContrib - sim.totalVPBen) >= 0 ? '#15803d' : '#b91c1c'}}>Balance del Estado (Aportes - Beneficios)</td>
                            <td style={{padding: '12px 0', fontWeight: 'bold', fontSize: '1.2rem', textAlign:'right', color: (sim.totalVPContrib - sim.totalVPBen) >= 0 ? '#15803d' : '#b91c1c'}}>
                                {formatCurrency(sim.totalVPContrib - sim.totalVPBen)}
                            </td>
                        </tr>
                        <tr>
                            <td style={{padding: '5px 0', fontSize: '0.9rem', color: '#64748b'}}>Por cada Guaraní aportado, recibe en Beneficio Vitalicio:</td>
                            <td style={{padding: '5px 0', fontWeight: 'bold', fontSize: '1rem', textAlign:'right', color: '#6366f1'}}>
                                {sim.tasaImplicita !== null ? sim.tasaImplicita.toFixed(2) : '-'} PYG
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            )}
        </div>

      </div>
    </div>
  );
};

export default SimuladorPensionPanel;
