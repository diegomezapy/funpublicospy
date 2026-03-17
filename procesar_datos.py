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

    columnas_usar = ['anio', 'mes', 'descripcionEntidad', 'codigoPersona', 'montoDevengado', 'cargo', 'sexo', 'tipoPersonal', 'concepto']
    
    # Procesar año por año
    for anio, archivos_anio in sorted(archivos_por_anio.items()):
        print(f"\n--- Procesando Año {anio} ({len(archivos_anio)} archivos) ---")
        lista_totales_anio = []
        lista_nomina_anio = []
        
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
                
                df['concepto'] = df['concepto'].fillna('NO ESPECIFICADO').str.strip().str.upper()
                df['descripcionEntidad'] = df['descripcionEntidad'].fillna('DESCONOCIDA').str.strip().str.upper()
                
                # 1. OPTIMIZACIÓN: Trabajar solo con valores únicos para Expresiones Regulares Costosas
                unique_entidades = pd.Series(df['descripcionEntidad'].unique())
                unique_conceptos = pd.Series(df['concepto'].unique())
                
                # 2. Limpieza de Caracteres SFP Corruptos sobre los Sets Unicos (Codificación vieja latin1 corrupta)
                clean_entidades = unique_entidades.str.replace('Ë', 'O', regex=False).str.replace('┌', 'U', regex=False).str.replace('Ð', 'N', regex=False).str.replace('═', 'I', regex=False).str.replace('┴', 'A', regex=False).str.replace('▄', 'U', regex=False)
                clean_conceptos = unique_conceptos.str.replace('Ë', 'O', regex=False).str.replace('┌', 'U', regex=False).str.replace('Ð', 'N', regex=False).str.replace('═', 'I', regex=False).str.replace('┴', 'A', regex=False).str.replace('▄', 'U', regex=False)
                
                # 3. Remover tíldes reales de inmediato para no dar la oportunidad a fallas posteriores
                clean_entidades = clean_entidades.str.normalize('NFKD').str.encode('ascii', errors='ignore').str.decode('utf-8')
                clean_conceptos = clean_conceptos.str.normalize('NFKD').str.encode('ascii', errors='ignore').str.decode('utf-8')

                # 4. Limpieza Agresiva de muletillas, colas de texto y prefijos numéricos ("016-", "016 - ", "016. MINISTERIO")
                # Elimina el prefijo institucional (ej: 001- , 016, etc.)
                clean_entidades = clean_entidades.str.replace(r'^\s*[\d\.\-\,]+(?:[\s\-]+)?', '', regex=True)
                
                # Consolidación general de sufijos ministeriales (limpia 'MINISTERIO DE EDUCACION Y CULTURA - ADM CENTRAL')
                clean_entidades = clean_entidades.str.replace(r'\s*-\s*ADM.*$', '', regex=True)
                
                # Conceptos: elimina sufijos de sueldos
                clean_conceptos = clean_conceptos.str.replace(r'\s*-\s*CORRESPONDIENTE AL MES.*$', '', regex=True)
                clean_conceptos = clean_conceptos.str.replace(r'\s*MES[\s:]*\d+$', '', regex=True)
                clean_conceptos = clean_conceptos.str.replace(r'\s*CORRESPONDIENTE AL MES\s*\d*$', '', regex=True)
                clean_conceptos = clean_conceptos.str.replace(r'\s*\(\d+\)$', '', regex=True) # sufijos como (111)
                
                # 5. Mapeo Semántico de Entidades (Agrupar historiales)
                ent_map = {
                    r'^MINISTERIO DE EDUCACION Y CUL.*$': 'MINISTERIO DE EDUCACION Y CIENCIAS',
                    r'^MINISTERIO DE EDUCACION Y CIE.*$': 'MINISTERIO DE EDUCACION Y CIENCIAS',
                    r'^MIN.*SALUD PUBLICA Y BIE.*$': 'MINISTERIO DE SALUD PUBLICA Y BIENESTAR SOCIAL',
                    r'^MIN.*SALUD PUBLICA.*$': 'MINISTERIO DE SALUD PUBLICA Y BIENESTAR SOCIAL',
                    r'^ADMINISTRACION NAC.*ELECTRICIDAD.*': 'ADMINISTRACION NACIONAL DE ELECTRICIDAD (ANDE)',
                    r'^INSTITUTO DE PREVISION SOCIAL.*': 'INSTITUTO DE PREVISION SOCIAL (IPS)',
                    r'^UNIVERSIDAD NACIONAL DE ASUNCION.*': 'UNIVERSIDAD NACIONAL DE ASUNCION (UNA)',
                    r'^MINISTERIO DE AGRICULTURA Y GANADERIA.*': 'MINISTERIO DE AGRICULTURA Y GANADERIA (MAG)'
                }
                clean_entidades = clean_entidades.replace(regex=ent_map)
                
                # 6. Mapeo Semántico de Conceptos (Unificar Tipos de Salarios)
                con_map = {
                    r'^SUELDO.*$': 'SUELDOS',
                    r'^SALARIO BASICO.*$': 'SUELDOS',
                    r'^SALARIO PRESUPUESTADO.*$': 'SUELDOS',
                    r'^SALARIO MENSUAL.*$': 'SUELDOS',
                    r'^SALARIO$': 'SUELDOS',
                    r'^JORNALES.*$': 'JORNALES',
                    r'^SUELDO/JORNAL$': 'JORNALES',
                    r'^GASTOS DE REPRESENT.*$': 'GASTOS DE REPRESENTACION',
                    r'^HONORARIOS.*$': 'HONORARIOS PROFESIONALES',
                    r'^AGUINALDO.*$': 'AGUINALDOS',
                    r'^ESCALAFON DOCENTE.*$': 'ESCALAFON DOCENTE',
                    r'^ESCALAFON DEL EDUCADOR.*$': 'ESCALAFON DOCENTE'
                }
                clean_conceptos = clean_conceptos.replace(regex=con_map)
                
                # Limpiar espacios colindantes de sobra tras el procesado global
                clean_entidades = clean_entidades.str.strip()
                clean_conceptos = clean_conceptos.str.strip()
                
                # 7. Crear diccionarios de Hash Rápido y retroalimentar a los Millones de Filas
                mapa_ent = dict(zip(unique_entidades, clean_entidades))
                mapa_con = dict(zip(unique_conceptos, clean_conceptos))
                
                df['descripcionEntidad'] = df['descripcionEntidad'].map(mapa_ent)
                df['concepto'] = df['concepto'].map(mapa_con)
                
                def p10(x): return x.quantile(0.10)
                def p50(x): return x.median()
                def p90(x): return x.quantile(0.90)

                agrup_persona = df.groupby(['anio', 'mes', 'gran_grupo', 'codigoPersona', 'sexo', 'tipoPersonal', 'descripcionEntidad', 'concepto'], dropna=False).agg(
                    monto_total_persona=('montoDevengado', 'sum')
                ).reset_index()
                
                agrup_persona.rename(columns={'descripcionEntidad': 'entidad_principal'}, inplace=True)

                agrup_persona['sexo_canon'] = agrup_persona['sexo'].str.upper().str.strip().replace({
                    'M': 'Hombres', 'MASCULINO': 'Hombres', 'H': 'Hombres', 'HOMBRE': 'Hombres',
                    'F': 'Mujeres', 'FEMENINO': 'Mujeres', 'MUJER': 'Mujeres'
                }).fillna('Desconocido')
                agrup_persona['is_hombres'] = (agrup_persona['sexo_canon'] == 'Hombres')
                agrup_persona['is_mujeres'] = (agrup_persona['sexo_canon'] == 'Mujeres')

                agrup_persona['contrato_canon'] = agrup_persona['tipoPersonal'].str.upper().fillna('DESCONOCIDO')
                agrup_persona['tipo_contrato'] = 'Otros'
                agrup_persona.loc[agrup_persona['contrato_canon'].str.contains('CONTRATADO', na=False), 'tipo_contrato'] = 'Contratado'
                agrup_persona.loc[agrup_persona['contrato_canon'].str.contains('PERMANENTE|COMISIONAD', na=False), 'tipo_contrato'] = 'Permanente'
                
                agrup_persona['is_permanente'] = (agrup_persona['tipo_contrato'] == 'Permanente')
                agrup_persona['is_contratado'] = (agrup_persona['tipo_contrato'] == 'Contratado')

                loc_totales = agrup_persona.groupby(['anio', 'mes', 'gran_grupo', 'sexo_canon', 'tipo_contrato', 'entidad_principal', 'concepto']).agg(
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
                
                lista_totales_anio.append(loc_totales)
                
                loc_nomina = df.groupby(['anio', 'mes', 'codigoPersona', 'descripcionEntidad']).agg(
                    monto_total_mes=('montoDevengado', 'sum')
                ).reset_index()
                loc_nomina.rename(columns={'descripcionEntidad': 'entidad_principal'}, inplace=True)
                
                lista_nomina_anio.append(loc_nomina)
                
                del df, agrup_persona, loc_totales, loc_nomina
                import gc
                gc.collect()
                
            except Exception as e:
                print(f"  [ERROR] en archivo {archivo}: {e}")
                
        # Guardar resultados del año y limpiar memoria
        f_totales = os.path.join(temp_dir, f"totales_{anio}.parquet")
        f_nomina = os.path.join(temp_dir, f"nomina_{anio}.parquet")
        
        if lista_totales_anio:
            totales_anio = pd.concat(lista_totales_anio)
            totales_anio = totales_anio.groupby(['anio', 'mes', 'gran_grupo', 'sexo_canon', 'tipo_contrato', 'entidad_principal', 'concepto']).agg(
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
            totales_anio.to_parquet(f_totales, index=False)
            del totales_anio
            
        if lista_nomina_anio:
            nomina_anio = pd.concat(lista_nomina_anio)
            nomina_anio = nomina_anio.groupby(['anio', 'mes', 'codigoPersona', 'entidad_principal']).agg(
                monto_total_mes=('monto_total_mes', 'sum')
            ).reset_index()
            nomina_anio.to_parquet(f_nomina, index=False)
            del nomina_anio
            
        del lista_totales_anio
        del lista_nomina_anio
        import gc
        gc.collect()
        print(f"  -> Año {anio} guardado en cache.")

    # Fase 2: Consolidar todos los años
    print("\n--- Consolidando todos los años ---")
    totales_paths = glob.glob(os.path.join(temp_dir, "totales_*.parquet"))
    nomina_paths = glob.glob(os.path.join(temp_dir, "nomina_*.parquet"))
    
    if totales_paths:
        totales_globales = pd.concat([pd.read_parquet(f) for f in totales_paths])
        totales_globales = totales_globales.groupby(['anio', 'mes', 'gran_grupo', 'sexo_canon', 'tipo_contrato', 'entidad_principal', 'concepto']).agg(
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
        totales_globales['entidad_principal'] = totales_globales['entidad_principal'].astype('category')
        totales_globales['concepto'] = totales_globales['concepto'].astype('category')
        totales_globales.to_parquet(os.path.join(output_dir, 'totales_historicos.parquet'), index=False, compression='zstd')
        print("-> Exportado totales_historicos.parquet")
    
    if nomina_paths:
        nomina_agrupada_global = pd.concat([pd.read_parquet(f) for f in nomina_paths])
        nomina_agrupada_global = nomina_agrupada_global.groupby(['anio', 'mes', 'codigoPersona', 'entidad_principal']).agg(
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
