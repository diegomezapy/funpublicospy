import pandas as pd
import numpy as np
import glob
import os
import shutil
import re
from collections import defaultdict

def procesar_nominas(input_dir='D:/GitHub/funpublicospy', output_dir='D:/GitHub/funpublicospy/data_procesada'):
    print("Iniciando procesamiento de nóminas optimizado (Por Año)...")
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    temp_dir = os.path.join(output_dir, 'temp_parquet')
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)

    # Buscar todos los archivos de nómina
    archivos_csv = glob.glob(os.path.join(input_dir, 'nomina_*.csv'))
    archivo_2013 = os.path.join(input_dir, 'funpub2013.csv')
    if os.path.exists(archivo_2013):
        archivos_csv.append(archivo_2013)
        
    print(f"Archivos encontrados: {len(archivos_csv)}")
    if len(archivos_csv) == 0:
        print("No se encontraron archivos CSV para procesar.")
        return

    # Agrupar archivos por año
    archivos_por_anio = defaultdict(list)
    for arch in archivos_csv:
        basename = os.path.basename(arch)
        match = re.search(r'nomina_(\d{4})', basename)
        if match:
            anio = match.group(1)
        elif '2013' in basename:
            anio = '2013'
        else:
            anio = 'UNKNOWN'
        archivos_por_anio[anio].append(arch)

    columnas_usar = ['anio', 'mes', 'descripcionEntidad', 'codigoPersona', 'montoDevengado', 'cargo', 'sexo', 'tipoPersonal']
    
    # Procesar año por año
    for anio, archivos_anio in sorted(archivos_por_anio.items()):
        print(f"\n--- Procesando Año {anio} ({len(archivos_anio)} archivos) ---")
        totales_anio = pd.DataFrame()
        nomina_anio = pd.DataFrame()
        
        for i, archivo in enumerate(archivos_anio):
            print(f"  [{i+1}/{len(archivos_anio)}] Leyendo: {os.path.basename(archivo)}")
            try:
                with open(archivo, 'r', encoding='latin1') as f:
                    first_line = f.readline()
                    sep = ';' if ';' in first_line else ','
                    
                col_map = {
                    'anho': 'anio',
                    'descripcion_entidad': 'descripcionEntidad',
                    'documento': 'codigoPersona',
                    'devengado': 'montoDevengado',
                    'estado': 'tipoPersonal'
                }
                
                df = pd.read_csv(archivo, sep=sep, encoding='latin1', low_memory=False, dtype=str)
                df.rename(columns=col_map, inplace=True)
                
                for c in columnas_usar:
                    if c not in df.columns:
                        df[c] = ''
                        
                df = df[columnas_usar]
                
                df['anio'] = pd.to_numeric(df['anio'], errors='coerce')
                df['mes'] = pd.to_numeric(df['mes'], errors='coerce')
                if df['montoDevengado'].dtype == object:
                    df['montoDevengado'] = df['montoDevengado'].str.replace('.', '', regex=False).str.replace(',', '.', regex=False)
                df['montoDevengado'] = pd.to_numeric(df['montoDevengado'], errors='coerce')
                
                df = df.dropna(subset=['anio', 'mes', 'codigoPersona', 'montoDevengado'])
                
                # Excluir Mes 13 (Aguinaldo) porque rompe la estética de la curva salarial base
                df = df[df['mes'] != 13]
                
                # Eliminar registros clonados idénticos en caso de que SFP haya publicado dobles
                df = df.drop_duplicates()
                
                texto_busqueda = df['descripcionEntidad'].str.upper().fillna('') + ' ' + df['cargo'].str.upper().fillna('')
                unique_text = texto_busqueda.unique()
                unique_df = pd.DataFrame({'texto': unique_text})
                
                cond_magisterio = unique_df['texto'].str.contains(r'MAGISTER|DOCENTE(?!\sUNIVERS)|EDUCACION|MEC', regex=True, na=False)
                cond_judicial = unique_df['texto'].str.contains(r'JUSTIC|JUDICIAL|CORTE|FISCAL|MINISTERIO\sPUBLICO|MAGISTR', regex=True, na=False)
                cond_universitario = unique_df['texto'].str.contains(r'UNIVERS|UNA|FACULTAD|RECTORAD|DOCENTE\sUNIVERS', regex=True, na=False)
                cond_fuerzas_armadas = unique_df['texto'].str.contains(r'DEFENSA|EJERCITO|ARMADA|AERONAUT|MILITAR|FUERZAS\sARMAD', regex=True, na=False)
                cond_policia = unique_df['texto'].str.contains(r'POLIC|INTERIOR|COMISAR|CADETE|BOMBER', regex=True, na=False)
                
                unique_df['gran_grupo'] = np.select(
                    [cond_magisterio, cond_judicial, cond_universitario, cond_fuerzas_armadas, cond_policia],
                    ['Magisterio Nacional', 'Magistrados Judiciales', 'Docentes Universitarios', 'Fuerzas Armadas', 'Fuerzas Policiales'],
                    default='Administración Pública'
                )
                
                mapping = unique_df.set_index('texto')['gran_grupo'].to_dict()
                df['gran_grupo'] = texto_busqueda.map(mapping)
                
                def p10(x): return x.quantile(0.10)
                def p50(x): return x.median()
                def p90(x): return x.quantile(0.90)

                agrup_persona = df.groupby(['anio', 'mes', 'gran_grupo', 'codigoPersona', 'sexo', 'tipoPersonal'], dropna=False).agg(
                    monto_total_persona=('montoDevengado', 'sum')
                ).reset_index()

                agrup_persona['sexo_canon'] = agrup_persona['sexo'].str.upper().str.strip().replace({
                    'M': 'Hombres', 'MASCULINO': 'Hombres', 'H': 'Hombres', 'HOMBRE': 'Hombres',
                    'F': 'Mujeres', 'FEMENINO': 'Mujeres', 'MUJER': 'Mujeres'
                })
                agrup_persona['is_hombres'] = (agrup_persona['sexo_canon'] == 'Hombres')
                agrup_persona['is_mujeres'] = (agrup_persona['sexo_canon'] == 'Mujeres')

                agrup_persona['contrato_canon'] = agrup_persona['tipoPersonal'].str.upper().fillna('DESCONOCIDO')
                agrup_persona['is_permanente'] = agrup_persona['contrato_canon'].str.contains('PERMANENTE|COMISIONAD', na=False)
                agrup_persona['is_contratado'] = agrup_persona['contrato_canon'].str.contains('CONTRATADO', na=False)

                loc_totales = agrup_persona.groupby(['anio', 'mes', 'gran_grupo']).agg(
                    monto_total_gastado=('monto_total_persona', 'sum'),
                    cantidad_funcionarios_unicos=('codigoPersona', 'nunique'),
                    monto_promedio_x_count=('monto_total_persona', 'sum'),
                    salario_mediana=('monto_total_persona', p50),
                    salario_p10=('monto_total_persona', p10),
                    salario_p90=('monto_total_persona', p90),
                    hombres=('is_hombres', 'sum'),
                    mujeres=('is_mujeres', 'sum'),
                    permanentes=('is_permanente', 'sum'),
                    contratados=('is_contratado', 'sum')
                ).reset_index()
                
                totales_anio = pd.concat([totales_anio, loc_totales])
                totales_anio = totales_anio.groupby(['anio', 'mes', 'gran_grupo']).agg(
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
                
                loc_nomina = df.groupby(['anio', 'mes', 'codigoPersona']).agg(
                    entidad_principal=('descripcionEntidad', 'first'),
                    monto_total_mes=('montoDevengado', 'sum')
                ).reset_index()
                
                nomina_anio = pd.concat([nomina_anio, loc_nomina])
                nomina_anio = nomina_anio.groupby(['anio', 'mes', 'codigoPersona']).agg(
                    entidad_principal=('entidad_principal', 'first'),
                    monto_total_mes=('monto_total_mes', 'sum')
                ).reset_index()
                
                del df
                del loc_totales
                del loc_nomina
                del agrup_persona
                
            except Exception as e:
                print(f"  [ERROR] en archivo {archivo}: {e}")
                
        # Guardar resultados del año y limpiar memoria
        f_totales = os.path.join(temp_dir, f"totales_{anio}.parquet")
        f_nomina = os.path.join(temp_dir, f"nomina_{anio}.parquet")
        
        if not totales_anio.empty:
            totales_anio.to_parquet(f_totales, index=False)
        if not nomina_anio.empty:
            nomina_anio.to_parquet(f_nomina, index=False)
            
        del totales_anio
        del nomina_anio
        print(f"  -> Año {anio} guardado en cache.")

    # Fase 2: Consolidar todos los años
    print("\n--- Consolidando todos los años ---")
    totales_paths = glob.glob(os.path.join(temp_dir, "totales_*.parquet"))
    nomina_paths = glob.glob(os.path.join(temp_dir, "nomina_*.parquet"))
    
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
        print("-> Exportado totales_historicos.parquet")
    
    if nomina_paths:
        nomina_agrupada_global = pd.concat([pd.read_parquet(f) for f in nomina_paths])
        nomina_agrupada_global = nomina_agrupada_global.groupby(['anio', 'mes', 'codigoPersona']).agg(
            entidad_principal=('entidad_principal', 'first'),
            monto_total_mes=('monto_total_mes', 'sum')
        ).reset_index()
        
        nomina_agrupada_global.rename(columns={'codigoPersona': 'cedula'}, inplace=True)
        nomina_agrupada_global['anio'] = nomina_agrupada_global['anio'].astype('int16')
        nomina_agrupada_global['mes'] = nomina_agrupada_global['mes'].astype('int8')
        nomina_agrupada_global['monto_total_mes'] = nomina_agrupada_global['monto_total_mes'].astype('float32')
        nomina_agrupada_global['cedula'] = nomina_agrupada_global['cedula'].astype('string')
        nomina_agrupada_global['entidad_principal'] = nomina_agrupada_global['entidad_principal'].astype('category')
        
        # Guardar particionado por año para eludir limite de Github Pages (100MB)
        anios_unicos = nomina_agrupada_global['anio'].unique()
        for a in anios_unicos:
            subset = nomina_agrupada_global[nomina_agrupada_global['anio'] == a]
            out_file = os.path.join(output_dir, f'nomina_{a}.parquet')
            subset.to_parquet(out_file, index=False, compression='zstd')
            print(f"-> Exportado {out_file}")
            
        print("-> Exportación de nóminas anuales particionadas finalizada.")
        
    print("¡Proceso Finalizado con Éxito!")

if __name__ == '__main__':
    procesar_nominas()
