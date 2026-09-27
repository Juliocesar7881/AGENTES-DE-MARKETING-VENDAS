# Deploy: dashboard na nuvem + worker em casa

Topologia recomendada quando você quer acessar o dashboard de qualquer lugar e continuar renderizando de graça
no seu computador:

```
Vercel (apps/web) ──┐                 ┌── Worker local (Windows/macOS/Linux)
  webhooks, OAuth,  │   Supabase      │   Remotion + FFmpeg, jobs de IA,
  inbox, checkout   ├── Postgres ─────┤   scheduler enquanto estiver online
  cron /api/cron    │   Storage       │
                    └─────────────────┘
```

Tudo roda também em **um único computador** (`pnpm build && pnpm start` + `start-worker.bat`), sem nuvem.

## 1. Supabase (banco + storage)

1. Crie um projeto em supabase.com.
2. Project Settings → Database → *Connection string*:
   - **Session pooler** (porta 5432) para o worker e para migrações.
   - **Transaction pooler** (porta 6543) para a Vercel, com `DATABASE_POOLER=true`.
3. Rode as migrações uma vez a partir do seu computador:
   ```bash
   DATABASE_URL="postgres://…:5432/postgres" pnpm db:migrate
   ```
   Elas criam as tabelas, a role `revenueos_app` (sem BYPASSRLS) e todas as políticas RLS.
4. Project Settings → API: copie a *Project URL* e a chave *service_role* (só servidor/worker — nunca no navegador).
   O bucket privado `revenueos` é criado automaticamente.

## 2. Vercel (dashboard)

1. Importe o repositório. **Root Directory: `apps/web`** (a Vercel detecta o workspace pnpm e instala da raiz).
2. Variáveis de ambiente (Production):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | Transaction pooler do Supabase |
   | `DATABASE_POOLER` | `true` |
   | `APP_ENCRYPTION_KEY` | a **mesma** do seu `.env` local (32 bytes base64) |
   | `APP_URL`, `NEXT_PUBLIC_APP_URL` | `https://seu-app.vercel.app` (ou domínio próprio) |
   | `CRON_SECRET` | segredo longo aleatório |
   | `STORAGE_DRIVER` | `supabase` |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | do passo 1 |
   | `DEMO_MODE_ENABLED` | `true` ou `false` |

3. Deploy. Na Vercel o runner embutido fica desligado automaticamente; o trabalho de nuvem roda em
   `/api/cron/tick` e logo após cada webhook/ação (`after()`).

## 3. Scheduler (tick a cada minuto)

O tick faz: buffer de conteúdo, agendamento em slots, follow-ups, métricas, entregas, expirações e retenção LGPD.
Ele é protegido por `Authorization: Bearer <CRON_SECRET>` e usa lease no banco (nunca roda em dobro).

- **Worker online**: o próprio worker roda o tick a cada 60 s — nada a configurar.
- **Vercel Pro**: troque o `schedule` em `apps/web/vercel.json` para `* * * * *`.
- **Vercel Hobby** (cron só 1×/dia — o `vercel.json` incluído usa diário para não quebrar o deploy):
  use o `pg_cron` do Supabase (Database → Extensions: habilite `pg_cron` e `pg_net`) e rode no SQL Editor:

  ```sql
  select cron.schedule(
    'revenueos-tick',
    '* * * * *',
    $$ select net.http_post(
         url := 'https://seu-app.vercel.app/api/cron/tick',
         headers := jsonb_build_object('Authorization', 'Bearer SEU_CRON_SECRET'),
         timeout_milliseconds := 60000
       ) $$
  );
  ```

  Ou qualquer serviço de uptime/pinger que envie o header acima.

## 4. Worker em casa

No `.env` (ou no `setup-worker.bat`, que guarda os segredos com DPAPI):

```
DATABASE_URL=<session pooler do Supabase>
APP_ENCRYPTION_KEY=<a mesma da Vercel>
APP_URL=https://seu-app.vercel.app
STORAGE_DRIVER=supabase
SUPABASE_URL=…
SUPABASE_SERVICE_ROLE_KEY=…
```

O worker renderiza em disco local e envia o MP4 para o storage **pouco antes do horário de postagem**
(`PREPARE_DELIVERY`); após a publicação o arquivo de entrega é removido da nuvem. Prévias no dashboard ficam
disponíveis se *Upload previews* estiver ligado no painel do worker.

## 5. URLs para as plataformas

Com `APP_URL` definido, a página **Help → Connections** mostra cada URL pronta para copiar:

- OAuth: `APP_URL/api/oauth/{instagram|facebook|tiktok|youtube}/callback`
- WhatsApp: `APP_URL/api/webhooks/whatsapp` · Instagram DM: `APP_URL/api/webhooks/instagram`
- Pagamentos: `APP_URL/api/webhooks/{mercadopago|stripe}/<workspace-id>`
- Saúde: `APP_URL/api/health`

## Checklist de produção

- [ ] `APP_ENCRYPTION_KEY` guardada em cofre (sem ela as credenciais salvas não podem ser lidas)
- [ ] Conta admin criada (a primeira conta) e `DEMO_MODE_ENABLED` decidido
- [ ] Chave da Anthropic testada em Settings → AI e orçamento definido
- [ ] Apps das redes aprovados/auditados conforme necessário (ver limitações no README)
- [ ] Webhooks de pagamento testados com credenciais de teste antes das de produção
- [ ] Backup diário do Postgres (Supabase faz automaticamente nos planos pagos; senão, `pg_dump` agendado)
