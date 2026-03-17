import pandas as pd
import os

path = 'D:/GitHub/funpublicospy/data_procesada/temp_parquet/nomina_2015.parquet'
if os.path.exists(path):
    df = pd.read_parquet(path)
    print(f"Total filas 2015: {len(df)}")
    entidades = df['entidad_principal'].unique()
    print("\n--- Top Entidades (Muestra Aleatoria) ---")
    for e in entidades[:40]:
        print(e)
    print(f"\nTotal Entidades Únicas en 2015: {len(entidades)}")
else:
    print("El archivo temp_parquet/nomina_2015.parquet no existe.")
