import pandas as pd
import sys

# Buscar una persona en 2023 y ver cuántas filas tiene y cómo se suman
df = pd.read_csv('D:/GitHub/funpublicospy/nomina_2023-01.csv', sep=';', encoding='latin1', dtype=str)
if len(df.columns) == 1:
    df = pd.read_csv('D:/GitHub/funpublicospy/nomina_2023-01.csv', sep=',', encoding='latin1', dtype=str)

df['montoDevengado'] = df.get('montoDevengado', df.get('devengado', pd.Series(dtype=str)))
df['montoDevengado'] = pd.to_numeric(df['montoDevengado'].str.replace('.','').str.replace(',','.'), errors='coerce').fillna(0)

# Filtrar a la primera persona
persona_1 = df['documento' if 'documento' in df.columns else 'codigoPersona'].iloc[0]
subset = df[df['documento' if 'documento' in df.columns else 'codigoPersona'] == persona_1]

print(f"Filas para persona 1 ({persona_1}):", len(subset))
print("Suma sueldos:", subset['montoDevengado'].sum())
print("Detalle:")
print(subset[['concepto' if 'concepto' in subset.columns else 'cargo', 'montoDevengado']])

