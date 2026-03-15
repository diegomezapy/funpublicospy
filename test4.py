import pandas as pd
import glob
import os

temp_dir = 'D:/GitHub/funpublicospy/data_procesada/temp_parquet'
output_dir = 'D:/GitHub/funpublicospy/data_procesada'

# Borrar archivos corruptos
for f in ["totales_2013.parquet", "nomina_2013.parquet"]:
    p = os.path.join(temp_dir, f)
    if os.path.exists(p):
        os.remove(p)

# Consolidar totales
totales_paths = glob.glob(os.path.join(temp_dir, "totales_*.parquet"))
if totales_paths:
    totales_globales = pd.concat([pd.read_parquet(f) for f in totales_paths])
    totales_globales = totales_globales.groupby(['anio', 'mes', 'gran_grupo']).agg(
        monto_total_gastado=('monto_total_gastado', 'sum'),
        cantidad_funcionarios_unicos=('cantidad_funcionarios_unicos', 'sum'),
        monto_promedio_x_count=('monto_promedio_x_count', 'sum'),
        salario_mediana=('salario_mediana', 'mean'), 
        salario_p10=('salario_p10', 'mean'),
        salario_p90=('salario_p90', 'mean'),
        hombres=('hombres', 'sum'),
        mujeres=('mujeres', 'sum'),
        permanentes=('permanentes', 'sum'),
        contratados=('contratados', 'sum')
    ).reset_index()
    totales_globales['monto_promedio'] = totales_globales['monto_promedio_x_count'] / totales_globales['cantidad_funcionarios_unicos']
    totales_globales.drop(columns=['monto_promedio_x_count'], inplace=True)
    totales_globales.to_parquet(os.path.join(output_dir, 'totales_historicos.parquet'), index=False)
    print("-> Reconstruido totales_historicos.parquet")
    print("Suma 2023-01:", totales_globales[(totales_globales['anio'] == 2023) & (totales_globales['mes'] == 1)]['monto_total_gastado'].sum())
