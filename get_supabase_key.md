# Come ottenere la SUPABASE_KEY

1. Vai su https://supabase.com/dashboard
2. Seleziona il tuo progetto (bdqdhuvfmgmhlxfhxkvj)
3. Vai su Settings → API
4. Trova la sezione "Project API keys"
5. Copia la **service_role key** (NON la anon key!)
   - La service_role key ha accesso completo al database
   - È necessaria per leggere le tabelle api_tokens e facebook_tokens

6. Aggiorna il file `.env` nel server MCP:
   ```
   SUPABASE_KEY=eyJ... (incolla qui la service_role key)
   ```

7. Su Render:
   - Vai nelle Environment Variables del servizio drivenmetrics-mcp
   - Aggiungi SUPABASE_KEY con il valore della service_role key

⚠️ IMPORTANTE: La service_role key è molto sensibile, non condividerla mai pubblicamente!