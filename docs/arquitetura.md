# Arquitetura

## O ciclo como eventos

Agentes nunca chamam uns aos outros. Cada passo grava um **evento** e, na mesma transação, os **jobs** que ele
dispara (outbox transacional — `packages/core/src/events.ts`):

| Evento | Próximo job | Quem executa |
|---|---|---|
| `CONTENT_NEEDED` (buffer abaixo da meta) | `STRATEGY_PLAN` | Strategist |
| `STRATEGY_CREATED` | `CREATIVE_GENERATE` (1 por ideia) | Creative → VideoSpec + legenda |
| `CONTENT_CREATED` | `RENDER_VIDEO` | Worker local (Remotion + FFmpeg + QA) |
| `RENDER_COMPLETED` | `SCHEDULE_CONTENT` | Scheduler → slot livre → `PUBLISH_POST` por rede |
| `POST_PUBLISHED` | `SYNC_METRICS` (+1 h, depois cadência decrescente) | Metrics |
| `MESSAGE_RECEIVED` | `SALES_REPLY` | Sales Agent (guardrails de preço, desconto, links, opt-out) |
| `PAYMENT_APPROVED` / `PAYMENT_REFUNDED` | `ATTRIBUTE_REVENUE` | Atribuição (ref code → link rastreado → inferência rotulada) |
| `REVENUE_ATTRIBUTED` | `LEARNING_UPDATE` | Aprendizado → contexto da próxima estratégia |
| `PERFORMANCE_REVIEW` (diário) / `WEEKLY_STRATEGY_DUE` | revisão / nova estratégia | Strategist |

O relógio é `runSchedulerTick()` (`packages/core/src/scheduler.ts`), executado pelo worker, pelo servidor
self-hosted ou por `/api/cron/tick`, com lease no banco para nunca rodar em paralelo.

## Fila de jobs

Tabela `jobs` no Postgres com `FOR UPDATE SKIP LOCKED`, lease renovável, retentativas com backoff,
idempotência por chave e recuperação de jobs cujo executor morreu. Cada tipo declara onde roda:

- **LOCAL** (worker): `STRATEGY_PLAN`, `CREATIVE_GENERATE`, `RENDER_VIDEO`, `PREPARE_DELIVERY`, `PROCESS_ASSET`,
  `WEBSITE_SCREENSHOT`, `VALIDATE_COMPOSITION`, `CLEANUP_LOCAL_RENDERS`
- **ANY** (nuvem ou worker): publicação, métricas, vendas, follow-up, atribuição, aprendizado, revisões, saúde de tokens, rollups

Antes de executar, o runner verifica: parada de emergência (jobs de saída ficam na fila, sem consumir tentativa),
status do negócio, agente pausado e orçamento de IA (jobs não essenciais são adiados até o orçamento renovar).

## Isolamento entre negócios

1. **RLS no Postgres**: as leituras do dashboard passam por `withUser(userId, fn)` → `SET LOCAL ROLE revenueos_app`
   + `app.user_id`; a role não tem BYPASSRLS e só enxerga linhas dos workspaces do usuário. Tabelas de segredos,
   sessões e rate limit não têm grant nenhum para ela.
2. **Checagens no servidor** antes de efeitos externos: post, conteúdo, conta social e job precisam ser do mesmo
   workspace para publicar; o checkout precisa ser do workspace da URL do webhook para virar pagamento.
3. **Contexto dos agentes** é montado só com dados do próprio workspace (`loadBusinessContext`).
4. Testado em `tests/integration/rls.test.ts`, `three-business.test.ts` e `failures.test.ts`.

## Falhas

| Falha | Comportamento |
|---|---|
| Claude timeout / 5xx | retentativa com backoff; esgotou → conteúdo `FAILED` com motivo, agente em `ERROR`, notificação |
| Render | retentativa; esgotou → `FAILED` mantendo o VideoSpec (botão Retry) |
| Uma rede falha | só aquele post falha; as outras redes publicam normalmente |
| Token expirado | conta `EXPIRED`, aviso ACTION REQUIRED, reconectar em Connections |
| TikTok não auditado | post privado ou rascunho no inbox do criador, rotulado no dashboard |
| Worker offline | jobs locais esperam na fila; alerta no topo e notificação |
| Webhook duplicado / forjado / de outro negócio | ignorado / 401 sem efeito / rejeitado (`PAYMENT_WORKSPACE_MISMATCH`) |
| Emergency stop | nada sai (posts, mensagens, checkouts); pagamentos e atribuição continuam |

Publicação é retomável: estado do provider persistido por post + lock por post evitam postar duas vezes.

## Escala (3 → 20 negócios)

Nenhuma mudança de código: limites são dados por workspace (`postsPerDay`, `maxContentGeneratedPerDay`,
`maxContentPublishedPerDay`, `targetReadyBuffer`, orçamento de IA). O gargalo é o render local — a concorrência
é ajustável no painel do worker (1–4) e vários workers podem apontar para o mesmo banco. Medido: um vídeo de
12 s em 1080×1920 renderiza em ~40 s numa máquina de 4 núcleos sem GPU (validação e QA incluídos), ou seja,
um vídeo de 30 s leva ~1,5–2 min. 20 negócios × 2 vídeos/dia ≈ 40 renders ≈ 1–1,5 h de máquina por dia.

## Pacotes

```
apps/web            Next.js (App Router, server actions, route handlers, proxy com CSP)
apps/worker         Worker local (fila LOCAL+ANY, painel 127.0.0.1:4417, bandeja, startup opt-in)
packages/shared     Tipos, schemas Zod, enums, crypto, env, SSRF, redaction, tempo/fuso
packages/database   Drizzle schema, migrações SQL (RLS), cliente, seed
packages/providers  AI / social / messaging / payment / storage (reais + mock)
packages/agents     Prompts versionados, validação e mocks determinísticos
packages/video-engine  Remotion (15 templates), render, validação ffprobe, QA, sandbox
packages/core       Domínio, fila, eventos, scheduler, handlers, demo/simulação
tests/              unit, integration (Postgres real) e e2e (Playwright)
```
