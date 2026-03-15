import pandas as pd
import numpy as np
import glob
import os

def procesar_nominas(input_dir='D:/GitHub/funpublicospy', output_dir='D:/GitHub/funpublicospy/data_procesada'):
    print("Iniciando procesamiento de nóminas optimizado (Iterativo)...")
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # Buscar todos los archivos de nómina
    archivos_csv = glob.glob(os.path.join(input_dir, 'nomina_*.csv'))
    archivo_2013 = os.path.join(input_dir, 'funpub2013.csv')
    if os.path.exists(archivo_2013):
        archivos_csv.append(archivo_2013)
        
    print(f"Archivos encontrados: {len(archivos_csv)}")
    if len(archivos_csv) == 0:
        print("No se encontraron archivos CSV para procesar.")
        return

    columnas_usar = ['anio', 'mes', 'descripcionEntidad', 'codigoPersona', 'montoDevengado', 'cargo', 'sexo', 'tipoPersonal']
    
    # DataFrames Master Globales para ir acumulando las agrupaciones
    totales_globales = pd.DataFrame()
    nomina_agrupada_global = pd.DataFrame()
    
    for i, archivo in enumerate(archivos_csv):
        print(f"[{i+1}/{len(archivos_csv)}] Procesando: {archivo}")
        try:
            # Leer el archivo puntual
            df = pd.read_csv(archivo, sep=",", encoding='ISO-8859-1', usecols=columnas_usar, low_memory=False)
            
            # Limpieza básica
            df['anio'] = pd.to_numeric(df['anio'], errors='coerce')
            df['mes'] = pd.to_numeric(df['mes'], errors='coerce')
            # Transformar posibles "5.500.000,00" o comas como decimales a float (usualmente es string en crudo o float sucio)
            # Como vimos que tienen coma decimal, lo pasamos a string y reemplazamos
            if df['montoDevengado'].dtype == object:
                df['montoDevengado'] = df['montoDevengado'].str.replace('.', '', regex=False).str.replace(',', '.', regex=False)
            df['montoDevengado'] = pd.to_numeric(df['montoDevengado'], errors='coerce')
            
            # Dropear nulos críticos
            df = df.dropna(subset=['anio', 'mes', 'codigoPersona', 'montoDevengado'])
            
            # Clasificar Gran Grupo Laboral (Vectorizado para velocidad reflejando R script de Trayectorias)
            texto_busqueda = df['descripcionEntidad'].str.upper().fillna('') + ' ' + df['cargo'].str.upper().fillna('')
            
            cond_magisterio = texto_busqueda.str.contains(r'MAGISTER|DOCENTE(?!\sUNIVERS)|EDUCACION|MEC', regex=True, na=False)
            cond_judicial = texto_busqueda.str.contains(r'JUSTIC|JUDICIAL|CORTE|FISCAL|MINISTERIO\sPUBLICO|MAGISTR', regex=True, na=False)
            cond_universitario = texto_busqueda.str.contains(r'UNIVERS|UNA|FACULTAD|RECTORAD|DOCENTE\sUNIVERS', regex=True, na=False)
            cond_fuerzas_armadas = texto_busqueda.str.contains(r'DEFENSA|EJERCITO|ARMADA|AERONAUT|MILITAR|FUERZAS\sARMAD', regex=True, na=False)
            cond_policia = texto_busqueda.str.contains(r'POLIC|INTERIOR|COMISAR|CADETE|BOMBER', regex=True, na=False)
            
            conditions = [
                cond_magisterio,
                cond_judicial,
                cond_universitario,
                cond_fuerzas_armadas,
                cond_policia
            ]
            
            choices = [
                'Magisterio Nacional',
                'Magistrados Judiciales',
                'Docentes Universitarios',
                'Fuerzas Armadas',
                'Fuerzas Policiales'
            ]
            
            df['gran_grupo'] = np.select(conditions, choices, default='Administración Pública')
            
            
            # 1. Calcular agrupamiento local para Totales Históricos
            def p10(x): return x.quantile(0.10)
            def p50(x): return x.median()
            def p90(x): return x.quantile(0.90)

            # Para que el cálculo sea representativo a nivel persona, primero agrupamos por persona
            agrup_persona = df.groupby(['anio', 'mes', 'gran_grupo', 'codigoPersona', 'sexo', 'tipoPersonal'], dropna=False).agg(
                monto_total_persona=('montoDevengado', 'sum')
            ).reset_index()

            # Demografía: cantidad por sexo
            agrup_persona['sexo_canon'] = agrup_persona['sexo'].str.upper().str.strip().replace({
                'M': 'Hombres', 'MASCULINO': 'Hombres', 'H': 'Hombres', 'HOMBRE': 'Hombres',
                'F': 'Mujeres', 'FEMENINO': 'Mujeres', 'MUJER': 'Mujeres'
            })
            agrup_persona['is_hombres'] = (agrup_persona['sexo_canon'] == 'Hombres')
            agrup_persona['is_mujeres'] = (agrup_persona['sexo_canon'] == 'Mujeres')

            # Demografía: cantidad por contrato
            agrup_persona['contrato_canon'] = agrup_persona['tipoPersonal'].str.upper().fillna('DESCONOCIDO')
            agrup_persona['is_permanente'] = agrup_persona['contrato_canon'].str.contains('PERMANENTE|COMISIONAD', na=False)
            agrup_persona['is_contratado'] = agrup_persona['contrato_canon'].str.contains('CONTRATADO', na=False)

            # Ahora calculamos las estadísticas demográficas por grupo
            # Nota: para simplificar agrupamos en base a los totales
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
            
            # Concatenar al master y reagrupar para fusionar
            # (En el script global tendremos que manejar promedios ponderados de las medianas si se solapan en Python, pero dado que procesamos por archivo mensual, mes a mes es exacto)
            totales_globales = pd.concat([totales_globales, loc_totales])
            totales_globales = totales_globales.groupby(['anio', 'mes', 'gran_grupo']).agg(
                monto_total_gastado=('monto_total_gastado', 'sum'),
                cantidad_funcionarios_unicos=('cantidad_funcionarios_unicos', 'sum'),
                monto_promedio_x_count=('monto_promedio_x_count', 'sum'),
                # Las medianas exactas requerirían todos los datos en RAM, para aproximarlo promediamos las medianas si de casualidad hay varios archivos para el mismo mes
                salario_mediana=('salario_mediana', 'mean'), 
                salario_p10=('salario_p10', 'mean'),
                salario_p90=('salario_p90', 'mean'),
                hombres=('hombres', 'sum'),
                mujeres=('mujeres', 'sum'),
                permanentes=('permanentes', 'sum'),
                contratados=('contratados', 'sum')
            ).reset_index()
            
            # 2. Calcular agrupamiento local por Empleado
            # Agrupamos por mes para sumar los diferentes conceptos de la misma persona
            loc_nomina = df.groupby(['anio', 'mes', 'codigoPersona']).agg(
                entidad_principal=('descripcionEntidad', 'first'),
                monto_total_mes=('montoDevengado', 'sum')
            ).reset_index()
            
            # Concatenar al master y reagrupar
            nomina_agrupada_global = pd.concat([nomina_agrupada_global, loc_nomina])
            # Si un archivo CSV viene con datos de múltiples años/meses y se solapan con los anteriores:
            nomina_agrupada_global = nomina_agrupada_global.groupby(['anio', 'mes', 'codigoPersona']).agg(
                entidad_principal=('entidad_principal', 'first'),
                monto_total_mes=('monto_total_mes', 'sum')
            ).reset_index()
            
            # Limpiar RAM
            del df
            del loc_totales
            del loc_nomina
            
        except Exception as e:
            print(f"Error en archivo {archivo}: {e}")
            
    # Proceso Final sobre Totales Globales
    print("Finalizando cálculo de métricas...")
    if not totales_globales.empty:
        # Simplificación de la métrica promedio:
        totales_globales['monto_promedio'] = totales_globales['monto_promedio_x_count'] / totales_globales['cantidad_funcionarios_unicos']
        totales_globales.drop(columns=['monto_promedio_x_count'], inplace=True)
        totales_globales.to_parquet(os.path.join(output_dir, 'totales_historicos.parquet'), index=False)
        print("-> Exportado totales_historicos.parquet")
    
    if not nomina_agrupada_global.empty:
        nomina_agrupada_global.rename(columns={'codigoPersona': 'cedula'}, inplace=True)
        # Reducir los tipos para ocupar mínimo espacio
        nomina_agrupada_global['anio'] = nomina_agrupada_global['anio'].astype('int16')
        nomina_agrupada_global['mes'] = nomina_agrupada_global['mes'].astype('int8')
        nomina_agrupada_global['monto_total_mes'] = nomina_agrupada_global['monto_total_mes'].astype('float32')
        nomina_agrupada_global['cedula'] = nomina_agrupada_global['cedula'].astype('string')
        # La entidad es redundante la mayor parte de las veces, convertirla a categórica ahorra mucho
        nomina_agrupada_global['entidad_principal'] = nomina_agrupada_global['entidad_principal'].astype('category')
        
        nomina_agrupada_global.to_parquet(os.path.join(output_dir, 'nomina_completa_optimizada.parquet'), index=False)
        print("-> Exportado nomina_completa_optimizada.parquet")
        
    print("¡Proceso Finalizado con Éxito!")

if __name__ == '__main__':
    procesar_nominas()
