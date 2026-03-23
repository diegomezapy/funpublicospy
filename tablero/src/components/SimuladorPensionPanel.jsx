import React, { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const SimuladorPensionPanel = () => {
  // --- Parámetros Salariales ---
  const [ageStart, setAgeStart] = useState(18);
  const [startingSalary, setStartingSalary] = useState(400);
  const [peakSalary, setPeakSalary] = useState(5000);
  const [peakAge, setPeakAge] = useState(45);
  const [curveShape, setCurveShape] = useState("En U Invertida");
  const [inflationRate, setInflationRate] = useState(2);
  const [yearsToUpdate, setYearsToUpdate] = useState(0);
  const [useCpi, setUseCpi] = useState(true);
  const [useMinWage, setUseMinWage] = useState(false);
  const [realSmlIncrease, setRealSmlIncrease] = useState(1);

  // --- Parámetros de Pensión ---
  const [retirementAge, setRetirementAge] = useState(60);
  const [lifeExpectancy, setLifeExpectancy] = useState(75);
  const [replacementRate, setReplacementRate] = useState(1.0);
  const [averagingPeriod, setAveragingPeriod] = useState(3);
  const [actuarialRate, setActuarialRate] = useState(5);
  const [contributionRate, setContributionRate] = useState(12);

  // --- Configuración Gráfico ---
  const [yAxisMin, setYAxisMin] = useState(0);
  const [yAxisMax, setYAxisMax] = useState(20000);

  // --- Lógica Matemática (equivalente a server R) ---
  const sim = useMemo(() => {
    const ageEnd = Math.max(lifeExpectancy + 10, ageStart);
    const ages = Array.from({ length: ageEnd - ageStart + 1 }, (_, i) => ageStart + i);
    const numYears = ages.length;

    const infRate = inflationRate / 100;
    const actRate = actuarialRate / 100;
    const contRate = contributionRate / 100;
    const smlRate = useMinWage ? (realSmlIncrease / 100) : 0;

    // 1. Array de Salarios
    let salaries = [];
    if (curveShape === "Ascendente") {
      salaries = ages.map((_, i) => startingSalary + (peakSalary - startingSalary) * (i / (numYears - 1 || 1)));
    } else if (curveShape === "Descendente") {
      salaries = ages.map((_, i) => peakSalary - (peakSalary - startingSalary) * (i / (numYears - 1 || 1)));
    } else if (curveShape === "En U Invertida") {
      salaries = ages.map(age => startingSalary + (peakSalary - startingSalary) * Math.exp(-Math.pow(age - peakAge, 2) / 100));
    } else if (curveShape === "En U") {
      salaries = ages.map(age => startingSalary + (peakSalary - startingSalary) * (1 - Math.exp(-Math.pow(age - peakAge, 2) / 100)));
    } else {
      salaries = ages.fill(startingSalary);
    }

    // 2. Salarios Reales
    const cumulativeInflation = ages.map(age => Math.pow(1 + infRate, age - ageStart));
    const realSalaries = salaries.map((sal, i) => sal / cumulativeInflation[i]);

    const retirementIdx = ages.findIndex(a => a >= retirementAge);
    const lifeExpectancyIdx = ages.findIndex(a => a >= lifeExpectancy);
    const safeRetirementIdx = retirementIdx >= 0 ? retirementIdx : (numYears - 1);
    const safeLifeExpectancyIdx = lifeExpectancyIdx >= 0 ? lifeExpectancyIdx : (numYears - 1);

    // 3. Revalorización
    const revaluationStartIdx = Math.max(safeRetirementIdx - yearsToUpdate, 0);
    const revaluationEndIdx = safeRetirementIdx - 1;
    let revaluedSalaries = [...salaries];

    let updateRate = 0;
    let formulaText = "";
    if (useCpi && useMinWage) {
      updateRate = (1 + infRate) * (1 + smlRate) - 1;
      formulaText = `Factor de Actualización: [(1 + ${(infRate*100).toFixed(1)}%) × (1 + ${(smlRate*100).toFixed(1)}%)]^n - 1`;
    } else if (useCpi) {
      updateRate = infRate;
      formulaText = `Factor de Actualización: (1 + ${(infRate*100).toFixed(1)}%)^n`;
    } else if (useMinWage) {
      updateRate = smlRate;
      formulaText = `Factor de Actualización: (1 + ${(smlRate*100).toFixed(1)}%)^n`;
    } else {
      formulaText = "Sin actualización";
    }

    if (updateRate !== 0 && revaluationStartIdx <= revaluationEndIdx && revaluationEndIdx >= 0) {
      for (let i = revaluationStartIdx; i <= revaluationEndIdx; i++) {
        const yrsToRet = retirementAge - ages[i];
        const reFactor = Math.pow(1 + updateRate, yrsToRet);
        revaluedSalaries[i] = salaries[i] * reFactor;
      }
    }

    // 4. Beneficios Pensiones
    const avgSalaryStartIdx = Math.max(safeRetirementIdx - averagingPeriod, 0);
    const avgSalaryPeriodUpdated = revaluedSalaries.slice(avgSalaryStartIdx, safeRetirementIdx);
    const avgSalaryPeriodOriginal = salaries.slice(avgSalaryStartIdx, safeRetirementIdx);

    const avgUpdated = avgSalaryPeriodUpdated.length > 0 ? (avgSalaryPeriodUpdated.reduce((a,b)=>a+b,0)/avgSalaryPeriodUpdated.length) : (salaries[safeRetirementIdx-1] || 0);
    const avgOriginal = avgSalaryPeriodOriginal.length > 0 ? (avgSalaryPeriodOriginal.reduce((a,b)=>a+b,0)/avgSalaryPeriodOriginal.length) : (salaries[safeRetirementIdx-1] || 0);

    const avgSalaryCombined = (avgUpdated + avgOriginal) / 2;
    const pensionBenefitNominal = avgSalaryCombined * replacementRate;
    const pensionNoUpdate = avgOriginal * replacementRate;

    const numPensionYears = safeLifeExpectancyIdx - safeRetirementIdx + 1;
    const pensionBenefitsNominal = Array(numPensionYears).fill(0).map((_, i) => pensionBenefitNominal * Math.pow(1 + infRate, i));
    const pensionBenefitsReal = pensionBenefitsNominal.map((p, i) => p / cumulativeInflation[safeRetirementIdx + i]);

    // 5. Vectores completos para el gráfico y KPIs
    const contribFull = Array(numYears).fill(null);
    let totalVPContrib = 0;
    for (let i = 0; i < safeRetirementIdx; i++) {
        const c = salaries[i] * contRate;
        contribFull[i] = c;
        totalVPContrib += c * Math.pow(1 + actRate, retirementAge - ages[i]);
    }

    const pensionNominalFull = Array(numYears).fill(null);
    const pensionRealFull = Array(numYears).fill(null);
    let totalVPBen = 0;

    for (let i = 0; i < numPensionYears; i++) {
        const curIdx = safeRetirementIdx + i;
        pensionNominalFull[curIdx] = pensionBenefitsNominal[i];
        pensionRealFull[curIdx] = pensionBenefitsReal[i];
        totalVPBen += pensionBenefitNominal / Math.pow(1 + actRate, ages[curIdx] - retirementAge);
    }

    // Llenar NAs para no dibujar líneas raras si la persona muere después de esperanza
    const salariesNominalFull = salaries.map((v, i) => i < safeRetirementIdx ? v : null);
    const salariesRealFull = realSalaries.map((v, i) => i < safeRetirementIdx ? v : null);
    const salariesRevFull = revaluedSalaries.map((v, i) => i < safeRetirementIdx ? v : null);

    const tasaImplicita = totalVPContrib !== 0 ? totalVPBen / totalVPContrib : null;

    return {
        ages, salariesNominalFull, salariesRealFull, salariesRevFull, 
        contribFull, pensionNominalFull, pensionRealFull,
        pensionNoUpdate, pensionBenefitNominal, totalVPContrib, totalVPBen, tasaImplicita, formulaText
    };
  }, [ageStart, startingSalary, peakSalary, peakAge, curveShape, inflationRate, yearsToUpdate, useCpi, useMinWage, realSmlIncrease, retirementAge, lifeExpectancy, replacementRate, averagingPeriod, actuarialRate, contributionRate]);

  // --- Datos de Gráfico ---
  const chartData = {
    labels: sim.ages,
    datasets: [
      {
        label: 'Salario Nominal',
        data: sim.salariesNominalFull,
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        pointRadius: 0
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
        label: 'Contribuciones Anuales',
        data: sim.contribFull,
        borderColor: 'rgba(249, 115, 22, 1)',
        borderWidth: 2,
        fill: false,
        tension: 0.1,
        pointRadius: 0
      },
      {
        label: 'Pensión Nominal',
        data: sim.pensionNominalFull,
        borderColor: 'rgba(34, 197, 94, 1)',
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        pointRadius: 0
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
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' }).format(ctx.raw)}`
        }
      }
    },
    scales: {
      x: { title: { display: true, text: 'Edad' } },
      y: { 
        min: yAxisMin, 
        max: yAxisMax,
        title: { display: true, text: 'Ingresos / Contribuciones (USD)' } 
      }
    }
  };

  const formatCurrency = (val) => new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' }).format(val);

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '20px', color: '#1e293b' }}>Simulador Actuarial Individual de Pensiones</h2>
      
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        
        {/* PANEL IZQUIERDO: Configuración */}
        <div style={{ flex: '1 1 350px', backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ borderBottom: '2px solid #cbd5e1', paddingBottom: '10px', marginTop: 0 }}>Parámetros Salariales</h3>
            
            <div className="input-group">
                <label>Edad de Inicio:</label>
                <input type="range" min="16" max="25" value={ageStart} onChange={e=>setAgeStart(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{ageStart} años</span>
            </div>
            <div className="input-group">
                <label>Salario Inicial (USD):</label>
                <input type="number" min="200" max="5000" step="100" value={startingSalary} onChange={e=>setStartingSalary(Number(e.target.value))} style={{width:'100%', padding:'5px'}}/>
            </div>
            <div className="input-group">
                <label>Salario Pico (USD):</label>
                <input type="number" min="1000" max="20000" step="500" value={peakSalary} onChange={e=>setPeakSalary(Number(e.target.value))} style={{width:'100%', padding:'5px'}}/>
            </div>
            <div className="input-group">
                <label>Edad Pico Salarial:</label>
                <input type="range" min="30" max="60" value={peakAge} onChange={e=>setPeakAge(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{peakAge} años</span>
            </div>
            <div className="input-group">
                <label>Forma de Curva Salarial:</label>
                <select value={curveShape} onChange={e=>setCurveShape(e.target.value)} style={{width:'100%', padding:'5px'}}>
                    <option value="Ascendente">Ascendente</option>
                    <option value="Descendente">Descendente</option>
                    <option value="En U Invertida">En U Invertida</option>
                    <option value="En U">En U</option>
                </select>
            </div>
            <div className="input-group">
                <label>Inflación General Anual (%):</label>
                <input type="range" min="0" max="10" step="0.5" value={inflationRate} onChange={e=>setInflationRate(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{inflationRate}%</span>
            </div>
            <div className="input-group">
                <label>Años a Actualizar/Revalorizar:</label>
                <input type="range" min="0" max="40" value={yearsToUpdate} onChange={e=>setYearsToUpdate(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{yearsToUpdate} años prev. a retiro</span>
            </div>
            <div className="input-group" style={{marginTop: '10px'}}>
                <label><input type="checkbox" checked={useCpi} onChange={e=>setUseCpi(e.target.checked)}/> Integrar IPC general al sueldo</label>
            </div>
            <div className="input-group">
                <label><input type="checkbox" checked={useMinWage} onChange={e=>setUseMinWage(e.target.checked)}/> Integrar Crecimiento Real del SML</label>
            </div>
            {useMinWage && (
                <div className="input-group">
                    <label>Incremento Real SML (%):</label>
                    <input type="range" min="0" max="5" step="0.1" value={realSmlIncrease} onChange={e=>setRealSmlIncrease(Number(e.target.value))} style={{width:'100%'}}/>
                    <span>{realSmlIncrease}%</span>
                </div>
            )}

            <h3 style={{ borderBottom: '2px solid #cbd5e1', paddingBottom: '10px', marginTop: '30px' }}>Parámetros Pensionales</h3>
            <div className="input-group">
                <label>Edad de Jubilación:</label>
                <input type="range" min="50" max="70" value={retirementAge} onChange={e=>setRetirementAge(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{retirementAge} años</span>
            </div>
            <div className="input-group">
                <label>Esperanza de Vida:</label>
                <input type="range" min="65" max="90" value={lifeExpectancy} onChange={e=>setLifeExpectancy(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{lifeExpectancy} años</span>
            </div>
            <div className="input-group">
                <label>Tasa de Reemplazo (Beneficio Prometido):</label>
                <input type="number" min="0.5" max="1.5" step="0.1" value={replacementRate} onChange={e=>setReplacementRate(Number(e.target.value))} style={{width:'100%', padding:'5px'}}/>
            </div>
            <div className="input-group">
                <label>Años de Base Promediables (meses):</label>
                <input type="range" min="1" max="10" value={averagingPeriod} onChange={e=>setAveragingPeriod(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{averagingPeriod} años ({averagingPeriod*12} meses)</span>
            </div>
            <div className="input-group">
                <label>Tasa de Contribución del Salario (%):</label>
                <input type="range" min="5" max="25" step="0.5" value={contributionRate} onChange={e=>setContributionRate(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{contributionRate}%</span>
            </div>
            <div className="input-group">
                <label>Tasa Actuarial de Descuento (%):</label>
                <input type="range" min="1" max="10" step="0.5" value={actuarialRate} onChange={e=>setActuarialRate(Number(e.target.value))} style={{width:'100%'}}/>
                <span>{actuarialRate}%</span>
            </div>

            <h3 style={{ borderBottom: '2px solid #cbd5e1', paddingBottom: '10px', marginTop: '30px' }}>Vista del Gráfico</h3>
            <div style={{display:'flex', gap:'10px'}}>
                <div style={{flex:1}}>
                    <label>Eje Y Min:</label>
                    <input type="number" value={yAxisMin} onChange={e=>setYAxisMin(Number(e.target.value))} style={{width:'100%', padding:'5px'}}/>
                </div>
                <div style={{flex:1}}>
                    <label>Eje Y Max:</label>
                    <input type="number" value={yAxisMax} onChange={e=>setYAxisMax(Number(e.target.value))} style={{width:'100%', padding:'5px'}}/>
                </div>
            </div>

        </div>

        {/* PANEL DERECHO: Gráficos e Indicadores */}
        <div style={{ flex: '1 1 600px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '15px', height: '500px' }}>
                <Line data={chartData} options={chartOptions} />
            </div>

            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '15px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#166534' }}>Fórmula de Actualización Salarial</h4>
                <code style={{ color: '#15803d', fontSize: '1rem', fontWeight: 'bold' }}>{sim.formulaText}</code>
            </div>

            <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '15px' }}>
                <h3 style={{ borderBottom: '2px solid #cbd5e1', paddingBottom: '10px', marginTop: 0 }}>Indicadores Clave de Desempeño Financiero</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '15px' }}>
                    <tbody>
                        <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                            <td style={{padding: '10px 0'}}>Monto Inicial de Pensión sin Actualización</td>
                            <td style={{padding: '10px 0', fontWeight: 'bold'}}>{formatCurrency(sim.pensionNoUpdate)}</td>
                        </tr>
                        <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                            <td style={{padding: '10px 0'}}>Monto Inicial de Pensión con Actualización</td>
                            <td style={{padding: '10px 0', fontWeight: 'bold'}}>{formatCurrency(sim.pensionBenefitNominal)}</td>
                        </tr>
                        <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                            <td style={{padding: '10px 0'}}>Valor Presente de Contribuciones (VP Aportes)</td>
                            <td style={{padding: '10px 0', fontWeight: 'bold', color: '#ea580c'}}>{formatCurrency(sim.totalVPContrib)}</td>
                        </tr>
                        <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                            <td style={{padding: '10px 0'}}>Valor Presente de Beneficios Futuros (VP Subsidio Pensión)</td>
                            <td style={{padding: '10px 0', fontWeight: 'bold', color: '#16a34a'}}>{formatCurrency(sim.totalVPBen)}</td>
                        </tr>
                        <tr>
                            <td style={{padding: '10px 0', fontSize: '1.1rem'}}>Tasa de Retorno Individual Implícita (VPBF / PVC)</td>
                            <td style={{padding: '10px 0', fontWeight: 'bold', fontSize: '1.2rem', color: '#6366f1'}}>
                                {sim.tasaImplicita !== null ? sim.tasaImplicita.toFixed(2) : '-'}x
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

      </div>
    </div>
  );
};

export default SimuladorPensionPanel;
