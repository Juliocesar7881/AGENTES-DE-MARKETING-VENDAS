# RevenueOS — Autonomous Revenue Engine

Sistema multi-negócio que transforma **conteúdo em vídeo em receita**: agentes de IA analisam cada negócio,
planejam e roteirizam vídeos, o worker local renderiza com Remotion/FFmpeg, o sistema agenda e publica nas
redes, captura os leads num CRM nativo, o Sales Agent conversa e envia checkout, o pagamento confirmado por
webhook vira receita atribuída ao vídeo — e o aprendizado alimenta a próxima estratégia.

```
NEGÓCIO → ANÁLISE → ESTRATÉGIA → IDEIA → ROTEIRO → MOTION DESIGN → VÍDEO → RENDER → AGENDAMENTO → PUBLICAÇÃO
→ VIEWS → CLIQUE → LEAD → CRM → CONVERSA → QUALIFICAÇÃO → OFERTA → CHECKOUT → PAGAMENTO → RECEITA
→ ATRIBUIÇÃO → APRENDIZADO → NOVA ESTRATÉGIA
```

O ciclo está no código: `packages/core/src/events.ts` (tabela `ROUTES`) liga cada evento ao próximo job.

---

## Arquitetura

| Parte | O que faz | Onde |
|---|---|---|
| **Control Plane** | Dashboard Next.js 16 (React 19, TS strict, Tailwind 4), server actions, webhooks, OAuth, cron | `apps/web` |
| **Local AI Worker** | Render Remotion + FFmpeg, jobs de IA (Claude), screenshots, sandbox de composições, painel local, bandeja do Windows | `apps/worker` |
| **Banco** | Postgres (local ou Supabase) com **RLS** por workspace, fila de jobs, eventos, auditoria | `packages/database` |
| **Core** | Orquestrador por eventos, fila com lease, scheduler, publicação, CRM, vendas, pagamentos, atribuição, aprendizado | `packages/core` |
| **Agentes** | Strategist, Creative, Sales, Classifier, Website analyzer (prompts versionados + validação Zod + guardrails) | `packages/agents` |
| **Providers** | `AIProvider` (Anthropic API, Claude Code CLI oficial, Mock), `SocialProvider` (Instagram, Facebook, TikTok, YouTube, Mock), WhatsApp/Instagram DM, Mercado Pago/Stripe/Mock, storage local/Supabase | `packages/providers` |
| **Video engine** | VideoSpec → 15 templates de motion design, safe zones, QA de conteúdo e técnico, trilha gerada (sem música protegida) | `packages/video-engine` |

Cada negócio é um **workspace** isolado (dados, marca, contas, agentes, agenda, orçamento). Adicionar o
20º negócio não exige mudar código: o scheduler percorre os workspaces ativos.

---

## Como rodar (um computador, sem terminal)

1. Instale o **Node.js 20+** (nodejs.org → LTS).
2. Dê dois cliques em **`RevenueOS.bat`** (Windows) ou **`RevenueOS.command`** (macOS). Na primeira vez ele
   instala as dependências, prepara o dashboard e oferece um atalho na área de trabalho.
3. O navegador abre sozinho no **instalador** (`/install`), com o código de configuração já preenchido:
   - **Banco de dados**: *Built-in database* (recomendado — um PostgreSQL 17 privado roda dentro do
     RevenueOS, só em 127.0.0.1, sem instalar nada), *My PostgreSQL* ou *Cloud database* (Supabase), com
     botão **Test connection**;
   - a chave de criptografia é gerada e salva no `.env`; tabelas e políticas de segurança (RLS) são criadas;
   - por fim você cria a **conta de administrador**.
4. Você cai no **assistente de configuração** (`/setup`), que traz tudo numa tela só, com os formulários
   reais e testes: Claude → worker local → negócio → apps das redes → contas sociais → pagamentos →
   WhatsApp → endereço público e armazenamento → **Go live** (modo Manual/Assisted/Autopilot por negócio,
   **Run all tests** e **Create the first video now**).

O launcher mantém dashboard, worker e banco rodando; fechar a janela desliga tudo na ordem certa.
Rodar de novo reaproveita tudo (e recompila sozinho após uma atualização). Linux: `pnpm launch`.

### Pelo terminal (desenvolvimento)

```bash
pnpm install
pnpm setup      # cria .env, gera APP_ENCRYPTION_KEY e CRON_SECRET, cria o banco, migra e faz seed
pnpm dev        # dashboard em http://localhost:3000 + worker local (render) juntos
```

- Só o dashboard: `pnpm dev:web` · só o worker: `pnpm worker`
- Produção local: `pnpm launch` (ou `pnpm build && pnpm start`; o scheduler roda embutido no servidor — desligue com `EMBEDDED_RUNNER=false`)
- Verificar a máquina do worker: `pnpm worker:check` (Node, banco, FFmpeg, pasta de render, IA, storage e um render de teste)

## Login demo

Na tela de login clique em **Explore Demo**. Não há senha: entra no usuário demo, que só enxerga os 3
negócios DEMO — **01 Pequenos Passos** (escola infantil), **02 Auto Prime** (oficina/estética automotiva) e
**03 OdontoFlow** (clínica odontológica) — com um dia já simulado. O indicador **DEMO** fica no topo; nada é
publicado de verdade. **Simulate Day** roda o pipeline inteiro de novo (estratégia → vídeo → post → lead →
conversa → checkout → pagamento → atribuição).

A **primeira conta criada** em *Create account* vira **administradora** (integrações, IA, worker, parada de emergência).

## Worker local (Windows)

Com o `RevenueOS.bat` o worker já sobe junto (ícone na bandeja). Para um worker **em outro computador**:

1. Dê dois cliques em **`setup-worker.bat`** (na raiz). Ele verifica Node/pnpm/espaço em disco, instala
   dependências, usa o `.env` ou pede `DATABASE_URL`/chaves e as guarda **criptografadas com DPAPI** do
   Windows, roda o check e oferece (opcional) atalho na área de trabalho e início com o Windows.
2. Depois use **`start-worker.bat`**. O worker fica minimizado na **bandeja** (ícone RevenueOS).
3. Painel local: **http://127.0.0.1:4417** — status *Online / Pending / Rendering / Today*, botões
   **Open Dashboard, Pause, Resume, Open Render Folder, Settings, Logs**.
4. Início com o Windows é **opt-in e reversível**: Settings do painel → *Enable start with computer*
   (entrada visível em Gerenciador de Tarefas → Aplicativos de inicialização; chave `HKCU\…\Run\RevenueOSWorker`).

Renders ficam em `D:\RevenueOS\renders` (se existir D:) ou `%USERPROFILE%\RevenueOS\renders`, organizados por
`<workspace>/<ano-mês>/<conteúdo>.mp4`. Logs e configuração em `%APPDATA%\RevenueOS`.
O worker envia heartbeat a cada 15 s; se ficar offline, os renders esperam na fila e o dashboard avisa.
macOS/Linux: `pnpm worker` (início automático opcional via LaunchAgent / `.desktop`).

## O que precisa ser conectado (produção)

Nada disso é necessário para a demo. Tudo é conectado **pela interface** — o assistente **Setup** (`/setup`)
guia passo a passo, com o formulário de cada item, o guia de onde pegar cada credencial, as URLs para copiar e
um botão de teste. OAuth oficial; credenciais ficam criptografadas (AES-256-GCM) no banco e nunca voltam ao
navegador. Detalhes e limites de cada plataforma em **Help → Connections** (`/help/connections`).

| Item | Onde | Para quê |
|---|---|---|
| Chave da Anthropic | Settings → AI | Estratégia, roteiros, vendas (produção **nunca** cai para Mock) |
| App Instagram / Meta / TikTok / Google | Settings → Developer apps | Uma vez por instalação |
| Contas sociais de cada negócio | Negócio → Connections → *Connect* | OAuth na página oficial da rede (sem senha) |
| WhatsApp Cloud API | Negócio → Connections | Sales Agent responder no WhatsApp |
| Mercado Pago e/ou Stripe | Negócio → Connections | Links de checkout + webhook de pagamento |
| Endereço público (https) | Setup → Public address & storage | Confirmação de pagamento, mensagens do WhatsApp/Instagram e publicação no Instagram (túnel Cloudflare grátis ou hospedagem) |
| Supabase Storage | Setup → Public address & storage | Só se o dashboard ficar na nuvem e o worker em casa (testado antes de salvar) |

### Anthropic

Settings → AI → cole a chave `sk-ant-…` → **Save & test** (é validada antes de salvar). Modelos por agente são
editáveis: padrão Opus para estratégia/criação, Sonnet para vendas, Haiku para classificação; o preset
**Economy** reduz ~60 % do custo por vídeo. Prompt caching ligado, custo registrado por chamada e **orçamento
diário/mensal** por negócio e global (jobs não essenciais param quando o limite é atingido).
Alternativa sem chave no worker: provider **Claude Code (local login)**, que usa apenas o modo não interativo
documentado do CLI oficial (`CLAUDE_CLI_PATH`).

### Redes sociais

| Rede | API oficial | Observações |
|---|---|---|
| Instagram Reels | Instagram API with Instagram Login | Conta Professional; em modo Development adicione a conta como tester |
| Facebook Reels | Pages API (Facebook Login for Business) | Opcional |
| TikTok | Content Posting API | Até passar na auditoria do TikTok os posts saem privados ou vão como rascunho na caixa do criador |
| YouTube Shorts | YouTube Data API v3 | Cota padrão ≈ 6 uploads/dia por projeto |

Redirect URI de cada app: `APP_URL/api/oauth/<instagram|facebook|tiktok|youtube>/callback`.

### Pagamentos

- **Mercado Pago** (prioridade): access token `APP_USR-…` + assinatura secreta do webhook. URL de notificação:
  `APP_URL/api/webhooks/mercadopago/<workspace-id>` (mostrada em Connections).
- **Stripe**: chave secreta/restrita + `whsec_…`; eventos `checkout.session.completed` e `charge.refunded`.
- Receita **só** nasce de webhook com assinatura válida, idempotente (`UNIQUE(provider, event_id)`), com status
  confirmado na API oficial e checagem de workspace. A IA dizer que vendeu nunca cria receita; venda manual
  fica marcada como `MANUAL`.

## Operação

- **Modos por negócio**: Manual, Assisted (recomendado — IA cria, você aprova posts/checkouts) e Autopilot,
  com matriz de permissões por ação em **/autopilot**.
- **Stop all / Emergency stop**: interrompe publicação, mensagens e checkouts em todos os negócios; pagamentos e
  atribuição continuam. Jobs de saída ficam na fila e retomam depois.
- **Inbox**: *Pause AI*, *Take over* e *Return to AI* em cada conversa; opt-out automático (parar, sair, stop…).
- **Conteúdo não publicado nunca é apagado** automaticamente; arquivos de entrega na nuvem são removidos após a publicação.
- **Analytics** usa linguagem observacional com rótulo de confiança (poucos dados = "sinal fraco").

## Segurança (resumo)

Sessões com token opaco (só o hash é salvo), cookies httpOnly/SameSite, rate limit em login/cadastro/formulários,
CSP com nonce por requisição, RLS no Postgres (`withUser` + role `revenueos_app`), checagem de workspace no
servidor antes de publicar/cobrar, segredos criptografados e **redigidos dos logs**, proteção SSRF no analisador
de sites, uploads validados (tipo/tamanho/SVG sanitizado), `spawn` com array de argumentos (sem shell),
composições geradas pela IA só rodam no sandbox com lista de imports permitida. Apenas APIs oficiais e OAuth —
sem automação de navegador em redes sociais ou no Claude, sem cookies, sem endpoints privados, sem senhas de redes.

## Testes

```bash
pnpm test:unit          # 85 testes: schemas, criptografia, assinaturas, SSRF, guardrails, layout, máquinas de estado, arquivo .env
pnpm test:integration   # Postgres isolado (revenueos_test): RLS, THREE BUSINESS TEST, falhas, pagamentos, auth e o ciclo completo com render real
pnpm test:e2e           # Playwright no build de produção com bancos isolados: demo, admin + assistente e instalação do zero pelo navegador; E2E_BUILD=1 força rebuild
pnpm lint && pnpm typecheck
```

Os testes de integração usam dublês **apenas** para plataformas externas (Claude, redes, WhatsApp, gateway);
banco, RLS, fila, orquestrador, render e atribuição são o código real. Cenários de falha cobertos: timeout do
Claude, falha de render, falha do Instagram isolada do TikTok, TikTok só-rascunho, token expirado, worker offline,
webhook duplicado/forjado/de outro negócio, parada de emergência e tentativa de publicar em conta de outro negócio.

## Deploy na nuvem

Veja [`docs/deploy.md`](docs/deploy.md) (Vercel + Supabase + worker em casa) e
[`docs/arquitetura.md`](docs/arquitetura.md) (ciclo, jobs, isolamento, custos).

## Limitações das plataformas externas

- **TikTok**: sem auditoria aprovada, só posts privados (`SELF_ONLY`) ou rascunho no inbox do criador.
- **Instagram**: conta Professional obrigatória; ~50 publicações via API por 24 h; app em Development só publica
  para testers até o App Review.
- **YouTube**: cota padrão ≈ 6 uploads/dia por projeto Google; app não verificado mostra aviso no consentimento.
- **WhatsApp**: resposta livre só até 24 h após a última mensagem do cliente; depois, apenas templates aprovados.
- **Métricas** chegam com atraso e variam por plataforma; a atribuição usa código de referência/link rastreado
  quando existe e inferência rotulada quando não.
- **Vercel Hobby**: cron no máximo 1×/dia — use Supabase `pg_cron` ou o próprio worker (roda o scheduler) para ticks por minuto.

## Licenças e custos

- **Remotion** é gratuito para pessoas físicas e empresas com até 3 funcionários; acima disso exige
  [licença de empresa](https://www.remotion.dev/license).
- Fonte Inter (OFL) servida localmente. Nenhum arquivo protegido por direitos autorais no repositório; a trilha
  sonora é sintetizada pelo próprio worker.
- Custos fixos podem ser zero (Postgres local ou Supabase free, render no seu PC). Custo variável: tokens do
  Claude (visível por chamada, por agente e por negócio em Settings → AI e Analytics) e taxas do gateway.

## Backup

Banco embutido: feche o RevenueOS e copie a pasta de dados (`%LOCALAPPDATA%\RevenueOS\pgdata` no Windows)
junto com o `.env`. Outros bancos: `pg_dump "$DATABASE_URL" > revenueos-$(date +%F).sql` (inclui credenciais criptografadas — guarde junto o
`APP_ENCRYPTION_KEY`, sem ele elas não podem ser lidas) e a pasta de renders. Trocar a chave exige reconectar integrações.
