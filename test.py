import pandas as pd
import numpy as np

# Comparar un mes de 2018 con uno de 2023
try:
    df_2018 = pd.read_csv('D:/GitHub/funpublicospy/nomina_2018-01.csv', sep=',', encoding='latin1', dtype=str)
    print("Muestra 2018:")
    print(df_2018['devengado'].head(10))
    print("Suma 2018:", pd.to_numeric(df_2018['devengado'].str.replace('.', '').str.replace(',', '.'), errors='coerce').sum())

    df_2023 = pd.read_csv('D:/GitHub/funpublicospy/nomina_2023-01.csv', sep=';', encoding='latin1', dtype=str)
    if len(df_2023.columns) == 1:
        df_2023 = pd.read_csv('D:/GitHub/funpublicospy/nomina_2023-01.csv', sep=',', encoding='latin1', dtype=str)
    print("\nMuestra 2023:")
    print(df_2023['montoDevengado' if 'montoDevengado' in df_2023.columns else 'devengado'].head(10))
    val_2023 = df_2023['montoDevengado' if 'montoDevengado' in df_2023.columns else 'devengado']
    print("Suma 2023:", pd.to_numeric(val_2023.str.replace('.', '').str.replace(',', '.'), errors='coerce').sum())

except Exception as e:
    print(e)
