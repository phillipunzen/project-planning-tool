import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env")) {
  console.log(".env ist bereits vorhanden; nichts überschrieben.");
  process.exit(0);
}
const secret = () => randomBytes(32).toString("hex");
writeFileSync(
  ".env",
  `APP_URL=http://localhost:8110\nALLOWED_ORIGINS=\nAPP_PORT=8110\nPORT=8111\nDATABASE_HOST=db.example.internal\nDATABASE_PORT=3306\nDATABASE_NAME=projektwerk\nDATABASE_USER=projektwerk\nDATABASE_PASSWORD=${secret()}\nDATABASE_ROOT_PASSWORD=${secret()}\nSESSION_SECRET=${secret()}\nTRUST_PROXY=0\n`,
  { mode: 0o600 },
);
console.log(
  ".env mit zufälligen Schlüsseln erstellt. Bitte Zugangsdaten der externen MariaDB eintragen oder docker-compose.local.yml verwenden.",
);
