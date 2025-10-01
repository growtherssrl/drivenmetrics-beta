# 📁 DrivenMetrics MCP - Project Structure

## 🏗️ Struttura Organizzata del Progetto

```
drivenmetrics-beta/
│
├── 📦 src/                      # Source code principale
│   ├── index.ts                 # Entry point del server MCP
│   └── routes/                  # Route handlers (opzionale)
│       └── chat.js              # Chat routes separate
│
├── 🌐 public/                   # File statici pubblici
│   ├── integrated-custom-chat.html  # Chat integrata principale ✅
│   ├── deep-marketing-chat.html     # Chat marketing intelligence
│   ├── custom-chat.html            # Chat standalone
│   ├── index.html                  # Homepage
│   └── settings.html               # Pagina impostazioni
│
├── 🎨 templates/                # Template EJS per rendering server-side
│   ├── login_oauth.ejs         # Login page
│   ├── dashboard.ejs           # Dashboard utente
│   ├── integrations.ejs        # Setup integrazioni
│   ├── deep_marketing.ejs      # Deep marketing form
│   ├── deep_marketing_results_v2.ejs  # Risultati analisi
│   ├── update_password.ejs     # Reset password
│   └── admin_webhooks.ejs      # Admin webhooks config
│
├── 📄 docs/                     # Documentazione
│   ├── PROJECT_STRUCTURE.md    # Questo file
│   ├── n8n-streaming-debug.md  # Debug guide per n8n
│   └── README.md               # Documentazione principale
│
├── 🔧 config/                   # File di configurazione
│   ├── .env                    # Variabili d'ambiente (non committare!)
│   ├── .env.example            # Template variabili d'ambiente
│   └── tsconfig.json           # TypeScript config
│
├── 📊 backup_*/                # Backup automatici (ignorati da git)
│
├── 🚫 node_modules/            # Dipendenze NPM (ignorato da git)
│
├── 🏗️ dist/                    # Build output TypeScript (ignorato da git)
│
└── 📋 File Root
    ├── package.json            # Dipendenze e scripts NPM
    ├── .gitignore             # File da ignorare in git
    ├── cleanup-system.js      # Script di pulizia sistema
    └── cleanup-report.json    # Report ultima pulizia

```

## 🎯 File Principali

### Core Application
- **`src/index.ts`** - Server MCP principale con tutte le route e logica
- **`public/integrated-custom-chat.html`** - Chat UI principale integrata

### Authentication & Sessions
- **`templates/login_oauth.ejs`** - Sistema di login OAuth2
- **`templates/dashboard.ejs`** - Dashboard utente autenticato

### Marketing Intelligence
- **`public/deep-marketing-chat.html`** - Chat specializzata per marketing
- **`templates/deep_marketing_results_v2.ejs`** - Visualizzazione risultati

### Configuration
- **`.env`** - Configurazione ambiente (Supabase, Facebook, n8n)
- **`package.json`** - Dipendenze e scripts di build/dev

## 🚀 Scripts Disponibili

```bash
# Development
npm run dev          # Avvia server in modalità development

# Production
npm run build        # Compila TypeScript
npm start           # Avvia server compilato

# Maintenance
node cleanup-system.js           # Pulisci file temporanei
node cleanup-system.js --dry-run # Mostra cosa verrebbe pulito
```

## 🔐 File Sensibili (Non Committare!)

- `.env` - Contiene chiavi API e secrets
- `dist/` - Build artifacts
- `node_modules/` - Dipendenze
- `*.log` - File di log
- `backup_*/` - Cartelle di backup

## 📝 Best Practices

1. **Modifiche al Server**: Edita `src/index.ts`, poi riavvia con `npm run dev`
2. **Nuove Route**: Aggiungi in `src/index.ts` nella sezione appropriata
3. **UI Changes**: Modifica i file HTML in `public/`
4. **Template Changes**: Modifica i file EJS in `templates/`
5. **Pulizia Regolare**: Esegui `node cleanup-system.js` periodicamente

## 🔄 Workflow Consigliato

1. **Prima di iniziare**: `git pull` per sincronizzare
2. **Durante lo sviluppo**: `npm run dev` per hot-reload
3. **Prima di committare**: 
   - `node cleanup-system.js` per pulire
   - Verifica `.gitignore` sia aggiornato
   - Non committare `.env` o chiavi API
4. **Deploy**: `npm run build && npm start`

## 📊 Stato Attuale

- ✅ Sistema pulito e organizzato
- ✅ File di test rimossi
- ✅ Struttura cartelle ottimizzata
- ✅ `.gitignore` aggiornato
- ✅ Documentazione presente

## 🛠️ Manutenzione

Per mantenere il progetto pulito:

```bash
# Pulizia settimanale consigliata
node cleanup-system.js

# Check dimensione progetto
du -sh ./* | sort -h

# Rimuovi dipendenze non usate
npm prune

# Aggiorna dipendenze
npm update
```

---
*Ultimo aggiornamento: 2 Settembre 2025*