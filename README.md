# Projektwerk

Webbasiertes Projektplanungstool für Teams, mit React, Node.js und MariaDB.

Repository: [phillipunzen/project-planning-tool](https://github.com/phillipunzen/project-planning-tool). Die Oberfläche unterstützt Deutsch und Englisch und ist für PC, Tablet und Handy ausgelegt.

## Funktionen

- Eigener Name und eigenes Logo unter „Administration → Allgemein“. Nur Administratoren dürfen die Einstellungen ändern. Name (1–60 Zeichen) und Logo gelten auf Anmeldung und Arbeitsbereich; das Logo dient auch als Browser-Symbol. PNG, JPG und WebP bis 2 MB und 4096 × 4096 Pixel, mit Vorschau und Entfernen-Funktion. Der Name liegt in MariaDB, das Logo im persistenten Upload-Volume; beide werden von der bestehenden Sicherung erfasst.

- Deutsch und Englisch: standardmäßig die erste unterstützte Browsersprache (sonst Englisch). Unter „Profileinstellungen → Sprache“ Deutsch, English oder Automatisch festlegen; die Wahl wird im Benutzerprofil in MariaDB für alle Geräte gespeichert. Eigene Projekt-, Bucket- und Karteninhalte werden nicht übersetzt. Neue Standard-Buckets und Beispielprojekte werden in der aktuellen Sprache angelegt.
- Hell- und Dunkelmodus über „Darstellung“ (System, Hell, Dunkel), auch auf der Anmeldeseite. Die Auswahl wird lokal im Browser gespeichert und zwischen offenen Tabs synchronisiert; „System“ folgt automatisch der Geräteeinstellung.
- Projekticons: 16 Symbole mit Projektfarbe, sichtbar in Navigation, Übersicht und Projektkopf. Beim Anlegen und unter „Projekteinstellungen → Projektsymbol“ auswählbar; Änderungen dürfen Projekteigentümer speichern.
- Projekte mit mehreren Kanban-Boards und frei anpassbaren Buckets (Statusspalten). Über „Buckets bearbeiten“ Überschriften und Farben ändern, Reihenfolge in beide Richtungen verschieben sowie Buckets hinzufügen oder leere Buckets entfernen (1–12 pro Board). Erledigt-Buckets sind frei markierbar und unabhängig von der Reihenfolge; bestehende Boards behalten ihre bisherige Erledigt-Spalte.
- Aufgaben mit Beschreibung, Priorität (niedrig, mittel, hoch, dringend), Fälligkeit, Verantwortlichem und Labels.
- Verschieben und Sortieren mit Maus, Touch-Griff oder Tastatur (Leertaste, Pfeile, Leertaste; Escape zum Abbrechen). Alternativ Status in den Aufgabendetails ändern.
- Checklisten mit einzelnen Punkten und Fortschrittsanzeige.
- Manueller Gesamtfortschritt pro Aufgabe mit fünf Buttons: 0 %, 25 %, 50 %, 75 % und 100 %. Anzeige auf Kanban-Karten und in der Liste; unabhängig von Statusspalte und Checkliste. Änderungen erscheinen im Board-Verlauf.
- Dateianhänge bis 20 MB pro Datei. Downloads sind durch Projektmitgliedschaft geschützt und werden als Download ausgeliefert.
- Bestehende Aufgabendetails speichern automatisch: Prozent-Buttons, Auswahlfelder und Checklisten direkt, Texte nach einer Sekunde Schreibpause oder beim Verlassen des Feldes. Beim Schließen werden ausstehende Änderungen gespeichert; Fehler und Konflikte bleiben sichtbar. Neue Aufgaben werden einmal mit „Aufgabe erstellen“ angelegt.
- Kommentare als Statusupdates und chronologischer Änderungsverlauf pro Board.
- Kanban-, Listenansicht, Suche, Prioritätsfilter und persönliche Aufgabenübersicht.
- Projekteigentümer, Bearbeiter und Leser. Administrationsrechte gewähren keinen automatischen Zugriff auf fremde Projekte.
- Persönliche Einladungslinks, die an eine E-Mail-Adresse gebunden sind und 7 Tage gelten. Keine automatische E-Mail-Zustellung.
- Administration für lokale Konten, Microsoft Active Directory über LDAPS/StartTLS oder OpenID Connect (z. B. Microsoft Entra ID, Keycloak).
- Gemeinsame MariaDB-Daten, Synchronisierung alle 5 Sekunden und Konflikterkennung bei gleichzeitigen Kartenänderungen.

## Fertiges Docker-Image aus GitHub Container Registry

Der Workflow `.github/workflows/docker-image.yml` baut Images für **linux/amd64 und linux/arm64** und veröffentlicht sie als Package dieses Repositorys unter `ghcr.io/phillipunzen/project-planning-tool`.

- `feature-card-progress`: aktueller Stand mit den fünf Fortschrittsbuttons.
- `latest`: aktueller veröffentlichter Stand, einschließlich der fünf Fortschrittsbuttons. Pushes auf `main` und den aktuellen Featurebranch aktualisieren dieses Tag.
- `main`: Stand des Hauptbranches, sobald der Workflow auf `main` enthalten ist und dort erfolgreich gelaufen ist.
- `sha-<vollständige Commit-ID>`: bestimmter Quellcode-Stand.
- Versionstags wie `v1.0.0` erzeugen zusätzlich das Image-Tag `1.0.0`.

In Pull Requests wird nur gebaut; es werden keine Images veröffentlicht. Pushes auf `main` und `feature/card-progress`, Versionstags und manuell gestartete Läufe veröffentlichen Images. Die Anmeldung erfolgt mit dem kurzlebigen `GITHUB_TOKEN` des Workflows und `packages: write`; ein separat gespeichertes Registry-Passwort ist nicht erforderlich.

Für den Betrieb **ohne lokalen Build** die `.env` wie unten mit der externen MariaDB und dem Sitzungsschlüssel einrichten, dann:

```bash
# Optional: auf eine bestimmte Version oder einen Digest festlegen.
# APP_IMAGE=ghcr.io/phillipunzen/project-planning-tool@sha256:... in .env

docker compose -f docker-compose.yml -f docker-compose.image.yml pull app
docker compose -f docker-compose.yml -f docker-compose.image.yml up -d --wait
```

Das Override `docker-compose.image.yml` entfernt die lokale Build-Konfiguration und verwendet `APP_IMAGE` (Standard: `ghcr.io/phillipunzen/project-planning-tool:latest`). Alle fünf MariaDB-ENV-Variablen und das Upload-Volume bleiben erhalten. Dafür ist Docker Compose >=2.24.4 erforderlich (`!reset`). Für den optionalen lokalen DB-Container `-f docker-compose.local.yml` vor dem Image-Override ergänzen.

Falls das Package privat ist, vorher mit einem GitHub-Konto mit Package-Zugriff anmelden (`docker login ghcr.io -u phillipunzen`, als Passwort ein Token mit `read:packages`). Für anonyme Downloads muss der Eigentümer in den Package-Einstellungen die Sichtbarkeit auf **Public** stellen. Ein öffentliches Quellcode-Repository macht neue GHCR-Packages nicht automatisch öffentlich.

Zum dauerhaften Auswählen des Image-Modus `COMPOSE_FILE=docker-compose.yml:docker-compose.image.yml` in `.env` setzen; anschließend funktionieren auch die normalen Betriebs- und Sicherungsbefehle. Die Image-Veröffentlichung enthält weder `.env`, Benutzerdateien noch Datenbankinhalte.

## Docker mit externer MariaDB (Standard)

Voraussetzungen: Docker Engine mit Compose, eine erreichbare MariaDB sowie Node.js >=20 für das einmalige Erzeugen der Konfiguration. Der App-Container verwendet Node.js 22. Die `docker-compose.yml` startet standardmäßig die Anwendung; sie enthält keinen Datenbankserver und keine Abhängigkeit von einem lokalen DB-Container.

```bash
git clone https://github.com/phillipunzen/project-planning-tool.git
cd project-planning-tool
node scripts/init-env.mjs
```

Anschließend die `.env` mit den Zugangsdaten der vorhandenen MariaDB ausfüllen:

```dotenv
APP_URL=http://localhost:8110
APP_PORT=8110
DATABASE_HOST=db.meine-firma.local
DATABASE_PORT=3306
DATABASE_NAME=projektwerk
DATABASE_USER=projektwerk
DATABASE_PASSWORD=das_passwort_des_datenbankkontos
```

Der `SESSION_SECRET` wird vom Skript zufällig erzeugt. Die Datenbank und das Konto müssen auf dem MariaDB-Server bereits vorhanden sein. Das Konto benötigt Schema- und Datenrechte für **diese** Datenbank, damit die Anwendung ihre Tabellen und Indizes erstellen kann; ein Root-Konto ist nicht erforderlich.

| ENV-Variable | Bedeutung | Standard |
| --- | --- | --- |
| `DATABASE_HOST` | DNS-Name oder IP der MariaDB | erforderlich |
| `DATABASE_PORT` | TCP-Port | `3306` |
| `DATABASE_NAME` | Vorhandene Datenbank | `projektwerk` |
| `DATABASE_USER` | Datenbankkonto | `projektwerk` |
| `DATABASE_PASSWORD` | Passwort dieses Kontos | erforderlich |

`localhost` und `127.0.0.1` bezeichnen innerhalb eines Containers den Container selbst. Läuft MariaDB auf dem Docker-Host, `DATABASE_HOST=host.docker.internal` verwenden; diese Zuordnung ist für Linux im Compose enthalten. Der MariaDB-Server muss TCP-Verbindungen vom App-Container zulassen.

```bash
docker compose -f docker-compose.yml up -d --build
```

Die Anwendung ist standardmäßig unter **http://localhost:8110** erreichbar. Auf der ersten Seite das Administratorkonto einrichten; es gibt keine voreingestellten Zugangsdaten. Das Beispielprojekt ist optional. Die Erstkonfiguration vor einer Freigabe an weitere Benutzer abschließen.

Die `.env` enthält Zugangsdaten und Sitzungsschlüssel und gehört nicht ins Repository. `scripts/init-env.mjs` überschreibt eine vorhandene `.env` nicht.

### Optional: eigener MariaDB-Container

Für einen Betrieb ohne vorhandene Datenbank zusätzlich `docker-compose.local.yml` verwenden:

```bash
node scripts/init-env.mjs
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Die zusätzliche Datei setzt den DB-Host der Anwendung auf `mariadb`, startet MariaDB 11.4 und wartet auf deren Healthcheck. Datenbankname, Benutzer und Passwort kommen weiterhin aus denselben ENV-Variablen; `DATABASE_ROOT_PASSWORD` wird nur in diesem Modus benötigt und ebenfalls vom Skript erzeugt. Die Datenbank wird nicht am Host veröffentlicht.

Zum dauerhaften Auswählen des lokalen Modus in `.env` ergänzen:

```dotenv
COMPOSE_FILE=docker-compose.yml:docker-compose.local.yml
```

Dann genügen `docker compose up -d` und die normalen Betriebsbefehle. Die bestehende Installation in dieser Arbeitsumgebung verwendet diese Variante; ihre Daten und Volumes bleiben erhalten.

### Zugriff von Handy und anderen Rechnern

In `.env` die von **allen Benutzern verwendete Adresse** setzen, z. B.:

```dotenv
APP_URL=https://projekte.meine-firma.de
APP_PORT=8110
TRUST_PROXY=1
```

Anschließend `docker compose up -d` ausführen. HTTPS kann über einen vorhandenen Reverse Proxy bereitgestellt werden. `TRUST_PROXY=1` gilt für genau einen vorgeschalteten Proxy; in diesem Fall den App-Port nur vom Proxy erreichen lassen. Ohne Proxy bleibt `TRUST_PROXY=0`. Für einen LAN-Test ist auch eine feste Adresse wie `APP_URL=http://192.168.1.20:8110` möglich.

`APP_URL` ist die feste externe Origin: Anmeldung, Einladungen, Redirect-URI, sichere Cookies und Schreibzugriffe richten sich danach. Für zusätzliche Vorschauadressen kann `ALLOWED_ORIGINS` explizit gesetzt werden (siehe unten). Bei HTTPS muss der Proxy `X-Forwarded-Proto: https` liefern. MariaDB wird im normalen Compose-Betrieb nicht auf dem Host veröffentlicht.

### Weitergeleitete Vorschauadressen

Wenn eine lokale Vorschau einen anderen Port verwendet, ihre genaue Origin zusätzlich in `.env` freigeben, zum Beispiel:

```dotenv
ALLOWED_ORIGINS=http://localhost:54734
```

Mehrere Adressen mit Komma trennen. Anschließend `docker compose up -d app` ausführen. Wildcards, fremde Webseiten und automatisch übernommene Forwarded-Host-Header werden nicht freigegeben. `APP_URL` bleibt die feste Hauptadresse für Einladungslinks und SSO-Redirects; bei Firmenanmeldung diese Hauptadresse verwenden. Die aktuelle Vorschauadresse dieser Arbeitsumgebung ist bereits zusätzlich konfiguriert.

## Anmeldeanbieter

### Lokale Anmeldung

Der erste Benutzer ist Administrator. Weitere Konten entstehen über eine Einladung oder unter **Administration → Benutzer**. Passwörter benötigen mindestens 10 Zeichen und werden mit bcrypt gehasht. Administratoren können lokale Passwörter neu setzen. Deaktivierte Benutzer verlieren ihren Zugriff auch in bereits laufenden Sitzungen.

### OpenID Connect / Microsoft Entra ID

1. Beim Anbieter eine Webanwendung registrieren.
2. Die in **Administration → Anmeldung → OpenID Connect** angezeigte Redirect-URI registrieren: `APP_URL/api/auth/oidc/callback`.
3. HTTPS-Issuer-URL, Client-ID, Client-Secret und optional Anzeigename eintragen.
4. Verbindung prüfen und Konfiguration speichern.
5. Einen Benutzer mit der vom Anbieter gelieferten E-Mail-Adresse zum Projekt einladen. Beim ersten Login den Einladungslink öffnen und die Firmenanmeldung wählen. Danach kann sich das Konto direkt per SSO anmelden.

Für Entra ID die konkrete Tenant-Issuer-URL `https://login.microsoftonline.com/<TENANT-ID>/v2.0` verwenden. Einen tenantübergreifenden `common`-Issuer unterstützt diese Version nicht. Der Anbieter muss das `email`-Claim liefern; gegebenenfalls einen optionalen Claim in der App-Registrierung aktivieren.

Standardmäßig wird `email_verified=true` verlangt. Wenn ein verwalteter Unternehmensanbieter wie Entra ID dieses Claim nicht liefert, kann der Administrator **E-Mail-Claim dieses Unternehmensanbieters vertrauen** aktivieren. Dies nur für einen kontrollierten Tenant verwenden. Konten werden anhand von Issuer und Subject identifiziert. Bestehende lokale Konten werden nicht automatisch aufgrund einer identischen E-Mail mit externen Identitäten verknüpft; für einen solchen Wechsel ist eine spätere explizite Kontenmigration nötig.

Die Implementierung nutzt Authorization Code Flow mit PKCE, State und Nonce. Client-Secrets sind optional für öffentliche Clients; das Provider-Metadatenprofil muss zum registrierten Client passen. Lokale Konten bleiben als Zugang erhalten.

### Microsoft Active Directory über LDAP

Unter **Administration → Anmeldung → Active Directory** konfigurieren:

- Server: `ldaps://dc.firma.local:636` oder `ldap://dc.firma.local:389` mit **StartTLS**.
- Base-DN: z. B. `DC=firma,DC=local`.
- Bind-DN: DN oder UPN eines Servicekontos mit Leserechten auf Benutzer und deren Attribute.
- Bind-Passwort des Servicekontos.
- Benutzersuchfilter: standardmäßig `(&(objectClass=user)(sAMAccountName={username}))`.

Die Anmeldung prüft zuerst das Verzeichnis mit dem Servicekonto, anschließend das Passwort per Bind als Benutzer. Das `mail`-Attribut muss gesetzt sein; deaktivierte AD-Konten werden abgelehnt. Erstmalige Benutzer benötigen eine passende Projekteinladung. `{username}` wird als LDAP-Filterwert maskiert.

Serverzertifikate werden validiert. Für eine interne CA das PEM-Zertifikat lesbar in den Container mounten und `NODE_EXTRA_CA_CERTS=/app/certs/firma-ca.pem` als Umgebungsvariable ergänzen. Keine Abschaltung der Zertifikatsprüfung.

Der Verbindungstest prüft beim OIDC-Anbieter die Discovery; bei LDAP TLS-Verbindung, Service-Bind und Base-DN. Die tatsächlichen Unternehmensanbieter müssen anschließend mit einem eingeladenen Testbenutzer geprüft werden. Es wurden hier keine Unternehmenszugangsdaten oder realen Tenant-/AD-Verbindungen bereitgestellt.

## Daten und Betrieb

Anhänge bleiben im Compose-Volume `uploads`. Bei externer MariaDB liegen Projekte, Benutzer und Sitzungen auf dem konfigurierten Datenbankserver; beim optionalen lokalen Modus speichert das Volume `mariadb-data` die Datenbank dauerhaft. Sitzungen liegen in MariaDB; ein Containerneustart verliert weder Projekte noch Sitzungen. Der `SESSION_SECRET` dient zusätzlich zur Verschlüsselung der Anbieter-Secrets. Den Schlüssel sichern und nicht ohne eine geplante Migration austauschen. Ein geänderter Schlüssel macht bestehende Sitzungen und verschlüsselte Anmeldedaten unbrauchbar.

```bash
docker compose ps
docker compose logs --tail=100 app
docker compose up -d --build     # nach Codeänderungen
docker compose stop             # anhalten; Daten bleiben erhalten
```

`GET /api/health` prüft auch die Datenbankverbindung. Die App besitzt einen Docker-Healthcheck, der die externe Datenbankverbindung mitprüft. Der optionale MariaDB-Container hat einen eigenen Healthcheck. Die App läuft als unprivilegierter `node`-Benutzer. Datei-Uploads werden auf ausgewählte Endungen begrenzt; ein Virenscanner ist in dieser Version nicht enthalten. Anhänge sollten daher wie andere intern geteilte Dateien behandelt werden.

Die erste Schema-Version erstellt fehlende Tabellen additiv; ein vorhandenes `Cards`-Schema erhält bei Bedarf die Checklisten- und Fortschrittsspalten. Bestehende Karten starten mit 0 Prozent; bestehende Daten bleiben erhalten. Es gibt kein automatisches `sync({alter:true})` oder Zurücksetzen von Nutzdaten. Für spätere Schemaänderungen sind versionierte Migrationen zu ergänzen.

### Sicherung und Wiederherstellung

`./scripts/backup.sh /sicherungen` erstellt eine Datenbanksicherung, eine Sicherung der Anhänge und eine geschützte Kopie der `.env`. Dafür startet es den optionalen MariaDB-Client `db-backup` (Profil `backup`) mit den konfigurierten DB-Zugangsdaten; es funktioniert mit der externen und der lokalen Datenbank. Das Konto benötigt zusätzlich die passenden Rechte für einen Dump inklusive Routinen und Triggern. Die Anwendung wird währenddessen kurz angehalten, damit Datenbank und Dateien zusammenpassen, und anschließend wieder gestartet. Sicherungen enthalten persönliche Daten und Zugangsschlüssel; das Zielverzeichnis nur für berechtigte Personen zugänglich halten. Regelmäßig eine Wiederherstellung in einer separaten Umgebung testen.

Für die Wiederherstellung zunächst die zum Backup gehörende `.env` wiederherstellen und den Dump in die bereitgestellte MariaDB importieren. Bei externer MariaDB die Sicherungs- und Wiederherstellungsabläufe mit deren Betreiber abstimmen; bei lokaler MariaDB zunächst den optionalen Container starten. Die Anhänge in ein temporär leeres Upload-Volume entpacken und dem Containerbenutzer UID 1000 zuordnen. Danach die App starten. Nie eine Wiederherstellung direkt über eine laufende Installation ausführen.

## Entwicklung und Tests

```bash
npm ci
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.dev.yml up -d mariadb
DATABASE_HOST=127.0.0.1 DATABASE_PORT=3317 npm run dev
```

Vite läuft auf Port 8110 und leitet `/api` an Port 8111 weiter. `docker-compose.dev.yml` veröffentlicht ausschließlich die optionale MariaDB auf `127.0.0.1:3317`. Die angegebenen ENV-Overrides verbinden den Node-Prozess auf dem Host mit dieser Datenbank. Für Entwicklung gegen eine externe Datenbank deren Werte verwenden und die lokalen Compose-Dateien weglassen. Zum Wechsel zwischen Docker-App und Vite die Docker-App anhalten, damit Port 8110 frei ist.

Die Tests verwenden ausschließlich die separate Datenbank `projektwerk_test`, löschen dort Daten und lassen die normale `projektwerk`-Datenbank unverändert. Das Testschema einmal auf einer Entwicklungsdatenbank vorbereiten. Im lokalen Modus:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS projektwerk_test; GRANT ALL ON projektwerk_test.* TO '\''projektwerk'\''@'\''%'\'';"'
DATABASE_HOST=127.0.0.1 DATABASE_PORT=3317 npm test
npm run build
npx playwright install chromium
DATABASE_HOST=127.0.0.1 DATABASE_PORT=3317 npm run test:ui
```

Tests nacheinander ausführen: API-, Auth- und Browsertests setzen dieselbe Testdatenbank zurück. API-Tests prüfen mit echter MariaDB unter anderem Einladungen, Rollen, geschützte Downloads, Uploadgrenzen, konkurrierende Änderungen und Sitzungswiderruf. Auth-Tests simulieren einen OIDC-Anbieter mit signierten Tokens und LDAP-Clientantworten; sie ersetzen keine Prüfung mit dem eigenen AD/Tenant. Browsertests prüfen Einrichtung, Kanban per Maus/Touch/Tastatur, Kartendetails, Uploads, Kommentare, Einladung eines zweiten Benutzers und mobile Ansichten. Screenshots entstehen unter `artifacts/`.

## Compose-Konfiguration prüfen

```bash
npm run test:compose
```

Diese Prüfung verwendet Beispielwerte ohne echte Zugangsdaten. Sie prüft, dass im Standardbetrieb alle fünf DB-Variablen durchgereicht werden, kein Datenbankserver gestartet wird und der optionale lokale Modus denselben Datenbanknamen und Benutzer verwendet.

## Technische Referenzen

- [OpenID-Client: API und Authorization Code Flow](https://github.com/panva/openid-client)
- [ldapts: Bind, StartTLS und Suchfilter](https://github.com/ldapts/ldapts)
- [dnd-kit: Sortable und Eingabesensoren](https://dndkit.com/legacy/presets/sortable/overview/)
- [Sequelize: MariaDB-Dialekt](https://sequelize.org/docs/v6/other-topics/dialect-specific-things/)
