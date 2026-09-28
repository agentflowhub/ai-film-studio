# Golden Test Case

Fælles testdatasæt til regressionstest af hele produktionskæden. Bruges af
enhedstests (`tests/unit/golden-test-case.test.ts`), af den klikbare
prototype (`prototype/build.mjs` indlejrer det) og senere af rigtige
genereringskørsler mod billed- og videoprovidere.

**Sander er testdata, ikke brand.** Han er en fiktiv karakter i
demofilmen "Golden Test Film" — aldrig produktnavn, projektnavn,
namespace, URL eller konfiguration. `tests/unit/brand-separation.test.ts`
håndhæver det.

## Indhold

| Felt | Indhold |
|---|---|
| `project` | Demoprojektets navn ("Golden Test Film"), mærket som demo |
| `idea`, `brief`, `film_dna`, `film_rules` | Filmens idé, brief, visuelle grammatik og regler |
| `assets` | Karakterer (Sander, Fru Holm, Per), locations, varevogn og props med attributter og kontinuitetsmønstre |
| `scenes`, `shots` | 4 scener, 12 shots, 60 sekunder |
| `cut_order` | Rækkefølgen shots skæres væk i, når filmen skal have færre shots |
| `scenarios` | De situationer datasættet er bygget til at udløse (kontinuitet, filmregel, forældet aktiv, samtykke, failover, model-routing) |
| `regression_areas` | De 19 områder, der regressionstestes |

Datasættet kan erstattes af en anden karakter, en kundes karakter eller en
anden genre uden ændringer i produktets kode.
