import os
import requests
import zipfile
import re
import io
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from concurrent.futures import ThreadPoolExecutor, as_completed

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def get_existing_months(base_dir):
    archivos_existentes = [f for f in os.listdir(base_dir) if f.startswith('nomina_') and f.endswith('.csv')]
    meses_existentes = set()
    for arch in archivos_existentes:
        match = re.search(r'nomina_(\d{4})-(\d{2})\.csv', arch)
        if match:
            meses_existentes.add(f"{match.group(1)}-{match.group(2)}")
    return meses_existentes

def download_file(item, base_dir):
    session = requests.Session()
    session.verify = False
    session.headers.update({'User-Agent': 'Mozilla/5.0'})
    retries = Retry(total=5, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
    session.mount('https://', HTTPAdapter(max_retries=retries))
    
    try:
        resp = session.get(item['url'], timeout=120)
        resp.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(resp.content))
        csv_in_zip = [name for name in z.namelist() if name.lower().endswith('.csv')]
        if not csv_in_zip:
            return f"   [!] No se encontró un CSV en {item['filename']}"
        csv_filename = csv_in_zip[0]
        dest_filename = os.path.join(base_dir, f"nomina_{item['key']}.csv")
        with z.open(csv_filename) as source, open(dest_filename, "wb") as target:
            target.write(source.read())
        return f"   [OK] Extraído como nomina_{item['key']}.csv"
    except Exception as e:
        return f"   [ERROR] Falló {item['key']}: {e}"

def main():
    base_dir = r"D:\GitHub\funpublicospy"
    os.makedirs(base_dir, exist_ok=True)
    
    print("1. Escaneando archivos locales existentes...")
    meses_existentes = get_existing_months(base_dir)
    print(f"Meses ya descargados: {len(meses_existentes)}")
    
    print("2. Obteniendo índice de archivos desde SFP...")
    api_url = "https://datos.sfp.gov.py/list/data"
    try:
        r = requests.get(api_url, verify=False, timeout=30)
        r.raise_for_status()
        data_json = r.json()
    except Exception as e:
        print(f"Error obteniendo lista: {e}")
        return
        
    archivos_servidor = data_json.get('data', [])
    archivos_nomina = []
    for filename in archivos_servidor:
        match = re.search(r'funcionarios_(\d{4})_(\d+)\.csv\.zip', filename)
        if match:
            y = int(match.group(1))
            m = int(match.group(2))
            if y >= 2015:
                key = f"{y}-{m:02d}"
                if key not in meses_existentes:
                    archivos_nomina.append({
                        'filename': filename, 'year': y, 'month': m, 'key': key,
                        'url': f"https://datos.sfp.gov.py/data/{filename}"
                    })
                
    print(f"Archivos nuevos a descargar: {len(archivos_nomina)}")
    
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(download_file, item, base_dir): item for item in archivos_nomina}
        for future in as_completed(futures):
            print(future.result())

if __name__ == '__main__':
    main()
