# Board API v1

Die REST-API für KI-Assistenten und Anwendungen liegt unter `/api/v1`. In **Profileinstellungen → API-Zugriff verwalten** einen Namen, Leserechte oder Schreibrechte, die freigegebenen Boards und eine Gültigkeit wählen. Den anschließend einmal angezeigten Token kopieren und als Geheimnis in der Anwendung hinterlegen. Token können in derselben Oberfläche widerrufen werden. Bis zu 20 aktive Tokens je Benutzer, bis zu 50 Boards je Token und wahlweise 1–365 Tage Gültigkeit oder **Unbegrenzt**. Unbegrenzte Tokens haben kein Ablaufdatum und bleiben bis zum Widerruf gültig; Board-Freigaben und aktuelle Benutzerberechtigungen werden weiterhin geprüft.

Die OpenAPI-3.0.3-Spezifikation ist für angemeldete Benutzer unter `/api/integration/openapi.json` und mit API-Token unter `/api/v1/openapi.json` verfügbar. Sie beschreibt die Methoden, Datenfelder, Bearbeitungsversionen und Statuscodes und kann von KI-/API-Werkzeugen eingelesen werden.

## Interaktive Swagger UI

Die Swagger UI liegt unter `/api/docs` und ist nach der Anmeldung erreichbar. In **Profileinstellungen → API-Zugriff verwalten → Swagger API-Dokumentation öffnen** öffnen, über **Authorize** den API-Token ohne den Präfix „Bearer“ eintragen und einen Endpunkt mit **Try it out → Execute** ausprobieren. Die JSON-Spezifikation bleibt über die bisherigen Endpunkte verfügbar.

Die Swagger-Oberfläche wird vollständig von der eigenen Installation geladen. Die Autorisierung wird nicht dauerhaft gespeichert und ist nach Neuladen der Seite erneut erforderlich. Anfragen verwenden dieselben Board-Freigaben, Schreibrechte und Versionsprüfungen wie externe API-Clients. Für Änderungen zuerst die aktuellen IDs sowie `version` oder `revision` lesen.

Beim Erstellen über `/api/me/api-tokens` bedeutet `expiresInDays: null` „Unbegrenzt“; ohne diese Angabe bleibt die Voreinstellung 90 Tage. Die Token-Metadaten enthalten für unbegrenzte Tokens `expiresAt: null`. Bestehende Tokens behalten ihr bisheriges Ablaufdatum.

## Anmeldung und Berechtigungen

Jede Anfrage benötigt `Authorization: Bearer <API_TOKEN>`. Keine Sitzungscookies, kein Login-Aufruf und kein `Origin`-Header nötig. Tokens gelten ausschließlich für `/api/v1`. Sie können keine Administration, Benutzerverwaltung, Einladungen oder weiteren Tokens steuern. Browser-Anfragen von anderen Webseiten werden nicht über CORS freigegeben; die API ist für serverseitige Integrationen vorgesehen. Außerhalb einer lokalen Installation HTTPS verwenden.

Ein Token erhält höchstens die aktuellen Projektberechtigungen seines Benutzers. Entzug der Mitgliedschaft, Herabstufung auf Betrachter, Deaktivierung des Kontos, Archivierung des Projekts, Ablauf oder Widerruf werden bei jedem Aufruf berücksichtigt. Die Board-Freigabe ist ausdrücklich auf die gewählten IDs begrenzt, einschließlich anderer Boards desselben Projekts. Tokens werden in der Datenbank nur als Hash gespeichert. Daten und API-Antworten werden nicht im Browser/PWA-Cache gespeichert. Die API erlaubt maximal 300 Anfragen pro Minute je Quell-IP, danach HTTP 429.

## Endpunkte

| Methode | Pfad ab `/api/v1` | Funktion |
| --- | --- | --- |
| GET | `/boards` | Aktuell freigegebene Boards mit Projektname und `canEdit` |
| GET | `/boards/{boardId}` | Board, Buckets (`columns`), Karten, Vorlagen und Board-`revision` |
| GET | `/boards/{boardId}/members` | Projektmitglieder für die Aufgaben-Zuweisung |
| GET | `/boards/{boardId}/templates` | Aktuelle Vorlagen und eigene Felddefinitionen |
| GET | `/cards/{cardId}` | Karte einschließlich aktuellem `version` |
| POST | `/boards/{boardId}/cards` | Neue Karte anlegen |
| PATCH | `/cards/{cardId}` | Felder einer Karte bearbeiten |
| POST | `/boards/{boardId}/move` | Karte verschieben oder innerhalb eines Buckets sortieren |
| DELETE | `/cards/{cardId}` | Karte mit Versionsprüfung löschen |
| GET / POST | `/cards/{cardId}/comments` | Kommentare lesen / ergänzen |
| GET | `/openapi.json` | OpenAPI-Spezifikation |

Schreibmethoden benötigen den Modus „Lesen und Aufgaben bearbeiten“ sowie aktuelle Bearbeitungsrechte. Vorlagen- und Bucket-Verwaltung sowie Dateianhänge werden weiterhin in der Oberfläche verwaltet.

## Beispiele mit curl

`API_BASE` auf die eigene Installation setzen. `API_TOKEN` über die Geheimnisverwaltung der aufrufenden Anwendung bereitstellen. Die Variablen `BOARD_ID`, `CARD_ID`, `COLUMN_ID`, `CARD_VERSION` und `BOARD_REVISION` aus den vorherigen Leseantworten übernehmen.

```bash
API_BASE='https://planung.example/api/v1'
curl --fail-with-body "$API_BASE/boards" \
  -H "Authorization: Bearer $API_TOKEN"

curl --fail-with-body "$API_BASE/boards/$BOARD_ID" \
  -H "Authorization: Bearer $API_TOKEN"

curl --fail-with-body -X POST "$API_BASE/boards/$BOARD_ID/cards" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"API-Aufgabe\",\"columnId\":\"$COLUMN_ID\",\"priority\":\"high\"}"

curl --fail-with-body -X PATCH "$API_BASE/cards/$CARD_ID" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"version\":$CARD_VERSION,\"progress\":50,\"description\":\"Status dokumentiert\"}"

curl --fail-with-body -X POST "$API_BASE/boards/$BOARD_ID/move" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"cardId\":\"$CARD_ID\",\"columnId\":\"$COLUMN_ID\",\"index\":0,\"revision\":$BOARD_REVISION}"
```

## Beispiel mit Python (Standardbibliothek)

```python
import json
import os
from urllib.request import Request, urlopen

base = os.environ["API_BASE"].rstrip("/")
token = os.environ["API_TOKEN"]

def api(path, method="GET", data=None):
    request = Request(
        base + path,
        method=method,
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json"},
        data=None if data is None else json.dumps(data).encode("utf-8"),
    )
    with urlopen(request, timeout=20) as response:
        return json.load(response)

boards = api("/boards")
board = api("/boards/" + boards[0]["id"])
card = api("/cards/" + board["cards"][0]["id"])
api("/cards/" + card["id"], "PATCH", {
    "version": card["version"],
    "progress": 50,
})
```

## Kartendaten und Konflikte

Beim Anlegen `title` und `columnId` setzen. Ohne `templateId` wird der aktuelle Board-Standard angewendet; `templateId: null` erstellt ohne Vorlage. Titel, Beschreibung, Priorität (`low`, `medium`, `high`, `urgent`), Fortschritt (0/25/50/75/100), `dueDate` (YYYY-MM-DD oder null), `assigneeId`, Labels und Checkliste sind bearbeitbar. Neue Checklistenpunkte benötigen eine eindeutige UUID, Text und `done`. Kommentare verwenden `{ "body": "Text" }`.

`PATCH` und `DELETE` benötigen die zuletzt gelesene Karten-`version`; Verschieben benötigt die aktuelle Board-`revision`, Ziel-`columnId` und den nullbasierten Zielindex. Verschieben erhöht auch die Versionen der betroffenen Karten. HTTP 409 bedeutet, dass zwischenzeitlich jemand geändert hat: den aktuellen Stand neu lesen, die Änderungen prüfen und die gewünschte Aktion gezielt wiederholen. Es gibt keine ungeprüfte Überschreibung.

Eigene Werte stehen in `customValues` mit Feld-UUID als Schlüssel. Für Dropdowns die Options-UUID aus der aktuellen verknüpften Vorlage verwenden. Textfelder enthalten Zeichenfolgen, Zahlenfelder Zahlen, Datumsfelder YYYY-MM-DD; null leert einen Wert. Beim Speichern des Werteobjekts die übrigen bereits vorhandenen Werte erhalten. Geänderte Dropdowns sind über die Vorlagendefinitionen sofort verfügbar. Bereits entfernte Werte bleiben als Historie erhalten; entfernte Felder sind nicht mehr bearbeitbar.

Fehler liefern JSON mit `error`. HTTP 400 = ungültige Daten, 401 = fehlender/ungültiger/abgelaufener Token, 403 = fehlende Rechte oder falsches Board, 404 = nicht gefunden, 409 = Versionskonflikt, 429 = zu viele Anfragen. Die `RateLimit`-Header zeigen das verfügbare Anfragebudget.
