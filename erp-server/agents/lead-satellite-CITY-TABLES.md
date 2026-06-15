# Lead Satellite V2 — City / Region Tables

Source: workflow `wKMX2cvDKlAc7p0N` ("EVERTRUST - LEAD SATELLITE V2 (Real Search + Local AI)"),
Code node **"Build Search Plan"**. Extracted verbatim from the node's `jsCode` on 2026-06-12.

## 1. REGION_CITIES

All 16 Polish voivodeships + all 16 German Länder + 2 alias keys (`niederschlesien`, `lowersilesia`).

```js
const REGION_CITIES = {
  'dolnoslaskie': ['Wrocław','Wałbrzych','Legnica','Jelenia Góra','Lubin','Głogów','Świdnica'],
  'kujawskopomorskie': ['Bydgoszcz','Toruń','Włocławek','Grudziądz','Inowrocław'],
  'lubelskie': ['Lublin','Zamość','Chełm','Biała Podlaska','Puławy'],
  'lubuskie': ['Zielona Góra','Gorzów Wielkopolski','Nowa Sól','Żary'],
  'lodzkie': ['Łódź','Piotrków Trybunalski','Pabianice','Tomaszów Mazowiecki','Bełchatów'],
  'malopolskie': ['Kraków','Tarnów','Nowy Sącz','Oświęcim','Chrzanów'],
  'mazowieckie': ['Warszawa','Radom','Płock','Siedlce','Pruszków','Ostrołęka'],
  'opolskie': ['Opole','Kędzierzyn-Koźle','Nysa','Brzeg'],
  'podkarpackie': ['Rzeszów','Przemyśl','Stalowa Wola','Mielec','Tarnobrzeg','Krosno'],
  'podlaskie': ['Białystok','Suwałki','Łomża'],
  'pomorskie': ['Gdańsk','Gdynia','Słupsk','Tczew','Sopot'],
  'slaskie': ['Katowice','Częstochowa','Sosnowiec','Gliwice','Zabrze','Bytom','Bielsko-Biała'],
  'swietokrzyskie': ['Kielce','Ostrowiec Świętokrzyski','Starachowice','Skarżysko-Kamienna'],
  'warminskomazurskie': ['Olsztyn','Elbląg','Ełk','Ostróda'],
  'wielkopolskie': ['Poznań','Kalisz','Konin','Piła','Leszno','Gniezno'],
  'zachodniopomorskie': ['Szczecin','Koszalin','Stargard','Kołobrzeg','Świnoujście'],
  'badenwurttemberg': ['Stuttgart','Mannheim','Karlsruhe','Freiburg im Breisgau','Heidelberg','Heilbronn','Ulm'],
  'bayern': ['München','Nürnberg','Augsburg','Regensburg','Würzburg','Ingolstadt','Fürth'],
  'berlin': ['Berlin'],
  'brandenburg': ['Potsdam','Cottbus','Brandenburg an der Havel','Frankfurt (Oder)','Oranienburg'],
  'bremen': ['Bremen','Bremerhaven'],
  'hamburg': ['Hamburg'],
  'hessen': ['Frankfurt am Main','Wiesbaden','Kassel','Darmstadt','Offenbach am Main','Gießen'],
  'mecklenburgvorpommern': ['Rostock','Schwerin','Neubrandenburg','Stralsund','Greifswald'],
  'niedersachsen': ['Hannover','Braunschweig','Osnabrück','Oldenburg','Wolfsburg','Göttingen','Hildesheim'],
  'nordrheinwestfalen': ['Köln','Düsseldorf','Dortmund','Essen','Duisburg','Bochum','Wuppertal','Bonn'],
  'rheinlandpfalz': ['Mainz','Ludwigshafen','Koblenz','Trier','Kaiserslautern'],
  'saarland': ['Saarbrücken','Neunkirchen','Homburg','Völklingen'],
  'sachsen': ['Dresden','Leipzig','Chemnitz','Zwickau','Görlitz','Plauen'],
  'sachsenanhalt': ['Magdeburg','Halle (Saale)','Dessau-Roßlau','Wittenberg'],
  'schleswigholstein': ['Kiel','Lübeck','Flensburg','Neumünster','Norderstedt'],
  'thuringen': ['Erfurt','Jena','Gera','Weimar','Gotha'],
  'niederschlesien': ['Wrocław','Wałbrzych','Legnica','Jelenia Góra','Lubin','Głogów','Świdnica'],
  'lowersilesia': ['Wrocław','Wałbrzych','Legnica','Jelenia Góra','Lubin','Głogów','Świdnica']
};
```

## 2. ZONE_CITIES

Both countries, all 5 zones each (north / south / east / west / nearborder).

```js
const ZONE_CITIES = {
  DE: { 'north': ['Hamburg','Bremen','Hannover','Kiel','Lübeck','Rostock','Oldenburg','Bremerhaven'], 'south': ['München','Stuttgart','Nürnberg','Augsburg','Karlsruhe','Freiburg im Breisgau','Ulm','Regensburg'], 'east': ['Berlin','Leipzig','Dresden','Chemnitz','Erfurt','Jena','Potsdam','Cottbus'], 'west': ['Köln','Düsseldorf','Dortmund','Essen','Frankfurt am Main','Duisburg','Bonn','Wuppertal'], 'nearborder': ['Frankfurt (Oder)','Görlitz','Cottbus','Guben','Bautzen','Zittau'] },
  PL: { 'north': ['Gdańsk','Gdynia','Szczecin','Olsztyn','Koszalin','Słupsk','Elbląg'], 'south': ['Kraków','Katowice','Wrocław','Bielsko-Biała','Rzeszów','Opole','Gliwice'], 'east': ['Lublin','Białystok','Rzeszów','Zamość','Suwałki','Przemyśl'], 'west': ['Poznań','Wrocław','Zielona Góra','Gorzów Wielkopolski','Szczecin','Kalisz'], 'nearborder': ['Szczecin','Zielona Góra','Gorzów Wielkopolski','Słubice','Zgorzelec','Jelenia Góra','Świnoujście'] }
};
```

## 3. NATION_REGIONS

```js
const NATION_REGIONS = { PL: ['dolnoslaskie','kujawskopomorskie','lubelskie','lubuskie','lodzkie','malopolskie','mazowieckie','opolskie','podkarpackie','podlaskie','pomorskie','slaskie','swietokrzyskie','warminskomazurskie','wielkopolskie','zachodniopomorskie'], DE: ['badenwurttemberg','bayern','berlin','brandenburg','bremen','hamburg','hessen','mecklenburgvorpommern','niedersachsen','nordrheinwestfalen','rheinlandpfalz','saarland','sachsen','sachsenanhalt','schleswigholstein','thuringen'] };
```

## 4. COUNTRY_ALIAS

The country alias map is named `COUNTRY_ALIAS` in the node.

```js
const COUNTRY_ALIAS = { 'de': 'DE', 'germany': 'DE', 'deutschland': 'DE', 'german': 'DE', 'ger': 'DE', 'pl': 'PL', 'poland': 'PL', 'polska': 'PL', 'polish': 'PL', 'pol': 'PL' };
```

Note: alias lookup is supplemented by a prefix fallback (not a table) in `resolveBuiltin`:

```js
const resolveBuiltin = (raw) => { const k = String(raw || '').toLowerCase().trim(); let cc2 = COUNTRY_ALIAS[k] || ''; if (!cc2 && k) { const cl = k.replace(/[^a-z]/g, ''); if (cl.indexOf('pol') === 0) cc2 = 'PL'; else if (cl.indexOf('ger') === 0 || cl.indexOf('deu') === 0) cc2 = 'DE'; } return cc2; };
```

## 5. DDG `kl` region mapping

There is **no literal mapping table** for the DuckDuckGo `kl` parameter in this node. It is computed inline by ternary expression (verbatim line below):

```js
const ddgKl = ccBuiltin === 'PL' ? 'pl-pl' : (ccBuiltin === 'DE' ? 'de-de' : (iso2 ? (iso2.toLowerCase() + '-' + langCode) : 'wt-wt'));
```

(So: PL → `pl-pl`, DE → `de-de`, other profiled countries → `<iso2>-<langCode>`, fallback → `wt-wt`.)
