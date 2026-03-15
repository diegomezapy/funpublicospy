import pandas as pd
import os

d = 'D:/GitHub/funpublicospy/data_procesada'
df = pd.read_parquet(f'{d}/nomina_completa_optimizada.parquet')
print('Cargado df maestro')
anios = df['anio'].unique()
print(f'Anios detectados: {anios}')

for a in anios:
    subset = df[df['anio'] == a]
    out_file = os.path.join(d, f'nomina_{a}.parquet')
    if os.path.exists(out_file):
        os.remove(out_file)
    subset.to_parquet(out_file, index=False, compression='zstd')
    print(f'-> Exportado {out_file}')
    
# Borrar el giga-archivo que Github rechaza
os.remove(f'{d}/nomina_completa_optimizada.parquet')
print('Borrado parquet masivo original para ahorrar limites')
