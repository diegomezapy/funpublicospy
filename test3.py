import pandas as pd

try:
    df1 = pd.read_parquet('D:/GitHub/funpublicospy/tablero/dist/data_procesada/totales_historicos.parquet')
    gasto_2023_01_dist = df1[(df1['anio'] == 2023) & (df1['mes'] == 1)]['monto_total_gastado'].sum()
    print("Gasto 2023-01 en dist/totales_historicos.parquet:", gasto_2023_01_dist)

    df2 = pd.read_parquet('D:/GitHub/funpublicospy/data_procesada/totales_historicos.parquet')
    gasto_2023_01_raiz = df2[(df2['anio'] == 2023) & (df2['mes'] == 1)]['monto_total_gastado'].sum()
    print("Gasto 2023-01 en data_procesada/totales_historicos.parquet:", gasto_2023_01_raiz)
    
except Exception as e:
    print(e)
