import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from calculo_tir_caja_fiscal import EstudioActuarialTIR
import warnings
warnings.simplefilter(action='ignore', category=FutureWarning)

def generar_visualizacion():
    print("Iniciando motor actuarial base...")
    estudio = EstudioActuarialTIR(crecimiento_salarial_anual=0.02, inflacion_anual=0.04)
    
    # 1. Obtenemos el diccionario con el cálculo empírico real por sector
    dict_resultados = estudio.analisis_global()
    
    if dict_resultados is None:
        print("No se pudieron cargar los datos historicos para graficar.")
        return

    # 2. Preparar la Data para Graficación
    nombres = []
    valores_tir = []
    colores = []
    
    for sector, tir in dict_resultados.items():
        if getattr(tir, "size", 1) == 1 and not np.isnan(tir): # Check is valid root (not nan)
            val_pct = tir * 100
            nombres.append(sector)
            valores_tir.append(val_pct)
            
            # Asignar color por gravedad / tipo
            if val_pct < 0:
                colores.append('#d62728') # Rojo: Destrucción de Capital
            elif val_pct > 100:
                colores.append('#ff7f0e') # Naranja: Rendimiento Absurdo (Ponzi)
            elif sector == 'TOTAL':
                colores.append('#1f77b4') # Azul: Benchmark Global
            else:
                colores.append('#2ca02c') # Verde: Rendimiento Positivo Normal
        else:
            # Sectores en pérdida indeterminada (Nunca tuvieron caja positiva, pura deuda)
            nombres.append(sector + "\n(Pérdida Pura)")
            valores_tir.append(-50) # Hacemos una barra roja negativa arbitraria para visualización
            colores.append('#d62728')

    # Convertimos a Dataframe para Seaborn
    df_plot = pd.DataFrame({
        'Sector': nombres,
        'TIR (%)': valores_tir,
        'Color': colores
    })
    
    # Ordenar por valor (de menor a mayor) para un mejor gráfico de barras
    df_plot = df_plot.sort_values(by='TIR (%)', ascending=True)

    # 3. Construir el Gráfico
    plt.figure(figsize=(12, 7))
    sns.set_theme(style="whitegrid")
    
    ax = sns.barplot(
        x='TIR (%)', 
        y='Sector', 
        data=df_plot, 
        palette=df_plot['Color'].tolist(),
        orient='h'
    )
    
    # Añadir las anotaciones numéricas en las barras
    for p in ax.patches:
        val = p.get_width()
        x_post = val + 5 if val > 0 else val - 15
        
        texto = f"{val:,.1f}%"
        if val == -50:
            texto = "Indeterminado\n(Déficit crónico)"
            
        ax.annotate(texto,
                    (x_post, p.get_y() + p.get_height() / 2.),
                    ha='left' if val > 0 else 'right',
                    va='center',
                    xytext=(5 if val > 0 else -30, 0),
                    textcoords='offset points',
                    fontsize=10, 
                    fontweight='bold', 
                    color='black')

    # 4. Formateo y Líneas de Referencia
    plt.axvline(x=0, color='black', linestyle='-', linewidth=1.5)
    plt.axvline(x=6.0, color='green', linestyle='--', linewidth=2, label='Crecimiento de la Economía (~6% ref)')
    
    plt.title('Tasa Implícita de Retorno (TIR) por Sector – Caja Fiscal Paraguaya (2011-2025)\nMagnitud de los Subsidios Extraídos y Sectores Deficitarios', fontsize=14, fontweight='bold', pad=15)
    plt.xlabel('Tasa Interna de Retorno Histórica (%)', fontsize=12, fontweight='bold')
    plt.ylabel('Caja Administrativa / Sector', fontsize=12, fontweight='bold')
    
    # Ajustar Eje X si hay valores absurdos como > 300%
    plt.xlim(-100, max(max(valores_tir)*1.15, 60)) 
    
    plt.legend(loc='lower right')
    plt.tight_layout()
    
    # Guardar en alta definición
    plt.savefig('TIR_Sectores_Caja_Fiscal.png', dpi=300)
    print("-> Gráfico guardado exitosamente como 'TIR_Sectores_Caja_Fiscal.png'")
    # plt.show() # Descomentar para ver en UI local interactiva si tienes X server

if __name__ == "__main__":
    generar_visualizacion()
