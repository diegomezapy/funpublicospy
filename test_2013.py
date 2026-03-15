import pandas as pd
try:
    df = pd.read_csv('D:/GitHub/funpublicospy/funpub2013.csv', sep=';', encoding='latin1', dtype=str, usecols=['anho' if 'anho' in pd.read_csv('D:/GitHub/funpublicospy/funpub2013.csv', sep=';', encoding='latin1', nrows=1).columns else 'anio'])
    print("Años en funpub2013.csv:", df.iloc[:,0].unique())
except Exception as e:
    print("Error fallback:", e)
    df = pd.read_csv('D:/GitHub/funpublicospy/funpub2013.csv', sep=',', encoding='latin1', dtype=str, usecols=['anho' if 'anho' in pd.read_csv('D:/GitHub/funpublicospy/funpub2013.csv', sep=',', encoding='latin1', nrows=1).columns else 'anio'])
    print("Años en funpub2013.csv (comma):", df.iloc[:,0].unique())
