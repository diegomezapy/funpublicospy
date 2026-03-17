import numpy as np
import pandas as pd
from scipy.optimize import newton

class EstudioActuarialTIR:
    """
    Motor Actuarial para estimar la Tasa Implícita de Retorno (TIR) 
    del Sistema Previsional de Reparto (Caja Fiscal).
    Contempla análisis Global y Análisis Individual / Cohorte.
    """
    def __init__(self, crecimiento_salarial_anual=0.03, inflacion_anual=0.04):
        self.g = crecimiento_salarial_anual  # Crecimiento real salarial
        self.inf = inflacion_anual           # Inflación esperada (meta BCP)
        
    def _vpn(self, tasa, flujos_caja):
        """Calcula el Valor Presente Neto iterativo para Newton-Raphson"""
        t = np.arange(len(flujos_caja))
        return np.sum(flujos_caja / ((1 + tasa) ** t))

    def tir_flujos(self, flujos_caja, guess=0.05):
        """Aplica Newton-Raphson para despejar la TIR neta"""
        # La derivada de la función de VNA
        def vpn_deriv(tasa):
            t = np.arange(len(flujos_caja))
            return np.sum(-t * flujos_caja / ((1 + tasa) ** (t + 1)))

        try:
            return newton(func=lambda r: self._vpn(r, flujos_caja), 
                          fprime=vpn_deriv, x0=guess, tol=1e-6)
        except RuntimeError:
            return np.nan

    def analisis_individual(self, 
                            edad_ingreso=25, 
                            edad_retiro=65, 
                            esperanza_vida_retiro=15, 
                            tasa_aporte=0.16, 
                            tasa_sustitucion=1.0,
                            salario_ingreso=3000000):
        """
        a) Modelado Individual:
        Evalúa a un individuo promedio. El flujo es negativo (aporta) durante
        los años laborales, y positivo (cobra jubilación) durante su retiro.
        Retorna la Tasa de Retorno lograda sobre sus propios esfuerzos contributivos.
        """
        años_aporte = edad_retiro - edad_ingreso
        
        # 1. Vector de Salarios Nominales Proyectados
        t_activo = np.arange(años_aporte)
        salarios = salario_ingreso * ((1 + self.g + self.inf) ** t_activo)
        aportes = - (salarios * tasa_aporte)
        
        # 2. Vector de Beneficios Jubilatorios Proyectados
        # Salario Regulador: promedio de los últimos 5 años (ejemplo)
        salario_regulador = np.mean(salarios[-5:]) 
        beneficio_anual_base = salario_regulador * tasa_sustitucion * 13 # 12 meses + Aguinaldo
        
        # Asumimos que la jubilación crece ajustada solo por inflación
        t_pasivo = np.arange(esperanza_vida_retiro)
        beneficios = beneficio_anual_base * ((1 + self.inf) ** t_pasivo)
        
        # 3. Ensamblar e igualar flujos al instante t=0 de la persona
        flujo_vida = np.concatenate((aportes, beneficios))
        
        tir = self.tir_flujos(flujo_vida)
        
        # Interpretación
        estado = "Equilibrada"
        crecimiento_nominal = self.g + self.inf
        if tir > crecimiento_nominal + 0.02:
            estado = "Favorable (Incentivos desalineados: Beneficio excede Riqueza Económica)"
        elif tir < crecimiento_nominal - 0.02:
            estado = "Desfavorable (Confiscatorio)"
            
        print("=== ANÁLISIS INDIVIDUAL / COHORTE ===")
        print(f"Edad Ingreso: {edad_ingreso} | Edad Retiro: {edad_retiro} | Esperanza Vida Jubilado: {esperanza_vida_retiro} años")
        print(f"Crecimiento Salarial Nominal Asumido (g + inf): {crecimiento_nominal*100:.2f}%")
        print(f"Salario Inicial: Gs. {salario_ingreso:,.0f} | Salario Final al Retiro: Gs. {salarios[-1]:,.0f}")
        print(f"Tasa Implícita de Retorno (TIR) del Individuo: {tir*100:.2f}%")
        print(f"Calificación Actuarial: {estado}\n")
        return tir

    def analisis_global(self, file_path='D:/GitHub/funpublicospy/documentos_caja_fiscal/historia_datos_caja_fiscal.xlsx'):
        """
        b) Análisis Global del Sistema (Por Sectores y Agregado)
        Calcula la TIR a partir de la historia real de la Caja Fiscal en el archivo Excel,
        desglosando por cada uno de los 6 programas contributivos.
        """
        print("=== ANÁLISIS GLOBAL HISTÓRICO POR SECTORES (Empírico) ===")
        try:
            df = pd.read_excel(file_path, sheet_name='datos')
            
            # Encontramos los índices donde dice 'Sectores'
            indices_sectores = df[df['Unnamed: 1'].str.strip() == 'Sectores'].index
            if len(indices_sectores) >= 2:
                idx_ingresos_start = indices_sectores[0] + 1
                idx_ingresos_end = df[df['Unnamed: 1'].str.strip() == 'TOTAL'].index[0]
                
                idx_gastos_start = indices_sectores[1] + 1
                idx_gastos_end = df[df['Unnamed: 1'].str.strip() == 'TOTAL'].index[1]
                
                df_ingresos = df.iloc[idx_ingresos_start:idx_ingresos_end+1].copy()
                df_gastos = df.iloc[idx_gastos_start:idx_gastos_end+1].copy()
                
                resultados = {}
                for i in range(len(df_ingresos)):
                    sector_nombre = str(df_ingresos.iloc[i, 1]).strip()
                    
                    ingresos = df_ingresos.iloc[i, 2:16].fillna(0).astype(float).values
                    gastos = df_gastos.iloc[i, 2:16].fillna(0).astype(float).values
                    
                    # Flujo asumiendo Inversión (-) y Beneficio (+) 
                    flujos_caja = gastos - ingresos
                    
                    # Para la ecuación clásica, el flujo inicial suele ser aporte (-)
                    flujos_caja = -ingresos + gastos
                    
                    tir_sector = self.tir_flujos(flujos_caja)
                    resultados[sector_nombre] = tir_sector
                    
                    if np.isnan(tir_sector):
                        estado = "Indeterminada / Pérdida Pura (Sin superávit inicial)"
                    else:
                        estado = f"{tir_sector*100:.2f}%"
                    
                    print(f"Sector: {sector_nombre:<25} | TIR Histórica (2011-2025): {estado}")
                print()
                return resultados
            else:
                print("Estructura de sectores no reconocida.")
                return None
        except Exception as e:
            print(f"Error procesando Archivo Excel: {e}")
            return None


if __name__ == "__main__":
    import warnings
    warnings.simplefilter(action='ignore', category=FutureWarning)
    
    estudio = EstudioActuarialTIR(crecimiento_salarial_anual=0.02, inflacion_anual=0.04)
    # Ejemplo 1: Funcionario Público Estándar (Trabaja 40 años, vive 15)
    estudio.analisis_individual(edad_ingreso=25, edad_retiro=65, esperanza_vida_retiro=15, tasa_sustitucion=1.0)
    
    # Ejemplo 2: Sector Docente (Trabaja 25 años, vive 25)
    estudio.analisis_individual(edad_ingreso=25, edad_retiro=50, esperanza_vida_retiro=25, tasa_sustitucion=0.93)
    
    # Análisis Macro (Historia Real de Paraguay)
    estudio.analisis_global()
