import pandas as pd

df = pd.read_csv('nomina_2023-01.csv', encoding='ISO-8859-1', usecols=['descripcionEntidad', 'cargo', 'descripcionPrograma'], nrows=200000)

print("--- POLICIAS / INTERIOR ---")
print(df[df['descripcionEntidad'].str.contains('INTERIOR', na=False)]['descripcionPrograma'].value_counts()[:10])

print("\n--- MILITARES / DEFENSA ---")
print(df[df['descripcionEntidad'].str.contains('DEFENSA NACIONAL', na=False)]['descripcionPrograma'].value_counts()[:10])

print("\n--- MAESTROS / EDUCACION ---")
print(df[df['descripcionEntidad'].str.contains('EDUCACI', na=False)]['cargo'].value_counts()[:10])

print("\n--- PROFESORES UNIVERSITARIOS ---")
print(df[df['descripcionEntidad'].str.contains('UNIVERSIDAD', na=False)]['cargo'].value_counts()[:10])
