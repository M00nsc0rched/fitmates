# FIT MATES

Edzéskövető PWA — edzésterv, vezetett edzés, regeneráció-követés, étrend és szintlépés.
Offline működik, telefonra telepíthető.

**Élő:** https://m00nsc0rched.github.io/fitmates/

## Fájlok

| fájl | mi ez |
|---|---|
| `index.html` | felület, stílus, beépített SVG-ikonkészlet |
| `app.js` | teljes logika (állapot, terv, edzés-vezetés, étrend, statisztika) |
| `sw.js` | service worker — offline cache |
| `manifest.webmanifest` | PWA-leíró |
| `icon-*.png` | app-ikonok |

Nincs build-lépés és nincs külső függőség: sima HTML/CSS/JS, a Pages a repó gyökerét
szolgálja ki.

## Munkamappák

- **Ez a repó a forrás** (`C:\Users\gergg\fitmates`) — itt kell szerkeszteni.
- `C:\iCloudDrive\- GAMES -\Claude gems\fitmates` = munka-/tükörmappa: itt vannak az
  eredeti prototípusok (`fm_1.txt`) és a referencia-képek. Az iCloud időnként átnevezi
  a fájlokat („app 3.js" jellegű másolatok), **ezért deploy előtt sose onnan másolj ide
  fájlnév-ellenőrzés nélkül.**

## Fejlesztés

Helyi kiszolgáló:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\iCloudDrive\- GAMES -\Claude gems\serve-fm.ps1"
```

Aztán: http://localhost:5178 (a szkript `$root` változója mondja meg, melyik mappát
szolgálja ki — szerkesztés előtt érdemes átállítani erre a repóra).

A kiszolgáló `Cache-Control: no-store` fejlécet küld, de a **service worker** így is
cache-elhet. Ha egy módosítás nem látszik: DevTools → Application → Service Workers →
Unregister + Clear storage, majd újratöltés.

## Deploy

```bash
git add -A && git commit -m "vN: ..." && git push
```

A GitHub Pages a `main` branch gyökeréből épít (nincs Actions-workflow), a push után
~1 perccel él az új verzió.

## Verziószabály

Az `app.js` tetején lévő `APP_VERSION` **mindig egyezzen** a `sw.js`-ben lévő
`CACHE = 'fitmates-vN'` számmal. Új kiadásnál mindkettőt együtt kell léptetni,
különben a telepített app a régi cache-ből szolgálja ki magát.
A jelenlegi verzió a Profil képernyő alján látszik.

## Adatok

Minden a böngésző `localStorage`-ában él (`fitmates_state` kulcs), szerver nincs.
A Profil képernyőn a mentés fájlba exportálható és visszatölthető.
