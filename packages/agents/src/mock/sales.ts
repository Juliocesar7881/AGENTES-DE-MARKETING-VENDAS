import { detectOptOut, normalizeText, type LeadSignal, type SalesIntent, type SalesReplyOutput } from "@revenueos/shared";
import type { SalesInput } from "../sales";
import { clip } from "./rng";

function has(t: string, words: string[]): boolean {
  return words.some((w) => t.includes(w));
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

/**
 * Deterministic, rule-based Sales Agent used by DEMO workspaces and tests.
 * It follows the same guardrails as the real agent: only Product Knowledge,
 * one question at a time, checkout only on explicit buying intent.
 */
export function mockSalesReply(input: SalesInput): SalesReplyOutput {
  const last = [...input.messages].reverse().find((m) => m.sender === "LEAD");
  const text = normalizeText(last?.body ?? "");
  const product = input.products.find((p) => p.id === input.lead.productId) ?? input.products[0];
  const name = input.lead.name ? input.lead.name.split(" ")[0] : "";
  const hello = name ? `Oi, ${name}!` : "Oi!";
  const signals = new Set<LeadSignal>();
  let intent: SalesIntent = "INTERESTED";
  let reply: string;
  let requestCheckout: SalesReplyOutput["requestCheckout"] = null;
  let qualified = input.lead.stage === "QUALIFIED" || input.lead.stage === "CHECKOUT";
  let handoff = false;
  let handoffReason: string | null = null;
  const outbound = input.messages.filter((m) => m.sender !== "LEAD").length;

  if (input.followUp) {
    const p = product;
    return {
      reply: clip(
        input.followUp.attempt === 1
          ? `${hello} Passando para saber se ficou alguma dúvida sobre ${p?.name ?? "o que conversamos"}. Posso te ajudar com algo?`
          : `${hello} Só um lembrete: ${p?.benefits[0]?.toLowerCase() ?? "estamos à disposição"}. Se quiser seguir, é só me responder por aqui.`,
        1200,
      ),
      intent: input.memory.intent === "OPT_OUT" ? "OPT_OUT" : "INTERESTED",
      signals: [],
      qualified,
      suggestedStage: input.lead.stage,
      requestCheckout: null,
      handoffToHuman: false,
      handoffReason: null,
      sensitive: false,
      followUpInHours: 48,
      memory: { ...input.memory, lastState: `Follow-up #${input.followUp.attempt} enviado` },
    };
  }

  if (detectOptOut(last?.body ?? "").optOut) {
    return {
      reply: "",
      intent: "OPT_OUT",
      signals: [],
      qualified: false,
      suggestedStage: "LOST",
      requestCheckout: null,
      handoffToHuman: false,
      handoffReason: null,
      sensitive: false,
      followUpInHours: null,
      memory: { ...input.memory, intent: "OPT_OUT", lastState: "Lead pediu para não ser contatado." },
    };
  }

  const buyWords = ["quero comprar", "quero fechar", "como pago", "como faco para pagar", "manda o link", "me manda o link", "pode mandar", "quero sim", "vamos fechar", "fechado", "quero contratar", "quero agendar", "como compro", "link de pagamento", "pix"];
  const priceWords = ["preco", "valor", "quanto custa", "quanto e", "quanto fica", "mensalidade", "custa"];
  const objectionPrice = ["caro", "desconto", "mais barato", "promocao"];
  const objectionTiming = ["depois", "vou pensar", "mais tarde", "semana que vem", "sem tempo"];
  const objectionTrust = ["funciona mesmo", "confiavel", "garantia", "golpe", "seguro"];
  const complaint = ["reclamacao", "processo", "advogado", "reembolso", "estorno", "pessimo"];

  if (has(text, complaint)) {
    intent = "SUPPORT";
    handoff = true;
    handoffReason = "Assunto sensível/reclamação — precisa de um humano.";
    reply = `${hello} Entendi. Vou passar sua mensagem agora para alguém da equipe que vai te ajudar pessoalmente, tudo bem?`;
  } else if (has(text, buyWords) && product) {
    intent = "READY_TO_BUY";
    signals.add("ASKED_HOW_TO_BUY");
    qualified = true;
    const discount = has(text, objectionPrice) && input.rules.maxDiscountPct > 0 ? Math.min(5, input.rules.maxDiscountPct) : 0;
    requestCheckout = { productId: product.id, discountPct: discount };
    reply = `Perfeito${name ? `, ${name}` : ""}! Vou te enviar o link seguro de pagamento do ${product.name} (${money(product.priceCents, product.currency)}). Qualquer dúvida é só me chamar aqui.`;
  } else if (has(text, priceWords) && product) {
    intent = "INTERESTED";
    signals.add("ASKED_PRICE");
    const benefit = product.benefits[0] ? ` Inclui: ${product.benefits.slice(0, 2).join(" e ").toLowerCase()}.` : "";
    reply = `${hello} O ${product.name} sai por ${money(product.priceCents, product.currency)}.${benefit}${product.offer ? ` ${product.offer}.` : ""} Quer que eu te envie o link para garantir?`;
  } else if (has(text, objectionPrice) && product) {
    intent = "OBJECTION";
    signals.add("PRICE_OBJECTION");
    reply = `Entendo! O valor considera ${product.benefits[0]?.toLowerCase() ?? "tudo que está incluso"}. ${product.offer ? `${product.offer}. ` : ""}Se fizer sentido para você, posso te mandar o link com a condição atual. O que acha?`;
  } else if (has(text, objectionTiming)) {
    intent = "OBJECTION";
    signals.add("TIMING_OBJECTION");
    reply = `Claro, sem pressa! Posso te chamar amanhã para tirar qualquer dúvida que surgir?`;
  } else if (has(text, objectionTrust) && product) {
    intent = "OBJECTION";
    signals.add("TRUST_OBJECTION");
    const faq = product.faq.find((f) => has(normalizeText(f.q), ["garantia", "funciona", "seguro", "confia"])) ?? product.faq[0];
    reply = faq ? `Boa pergunta! ${faq.a} Posso te ajudar com mais alguma dúvida?` : `Boa pergunta! Vou confirmar os detalhes com a equipe e já te retorno.`;
    if (!faq) {
      handoff = true;
      handoffReason = "Pergunta sem resposta na base de conhecimento.";
    }
  } else if (product) {
    const faq = product.faq.find((f) => normalizeText(f.q).split(" ").filter((w) => w.length > 4 && text.includes(w)).length >= 1);
    if (faq) {
      reply = `${faq.a} Quer saber o valor ou como funciona para você?`;
    } else if (outbound === 0) {
      reply = `${hello} Que bom te ver por aqui 😊 Vi que você se interessou pelo ${product.name}. Me conta: o que você está buscando resolver hoje?`;
    } else {
      signals.add("POSITIVE_SENTIMENT");
      qualified = qualified || text.length > 12;
      reply = `Faz total sentido. O ${product.name} foi pensado exatamente para isso: ${product.benefits[0]?.toLowerCase() ?? product.description.toLowerCase()}. Quer que eu te passe o valor e como começar?`;
    }
  } else {
    reply = `${hello} Obrigado pelo contato! Me conta um pouco mais do que você precisa?`;
  }

  if (/\d{2}\s?\d{4,5}-?\d{4}/.test(last?.body ?? "") || /@/.test(last?.body ?? "")) signals.add("SHARED_CONTACT_INFO");
  const suggestedStage = requestCheckout ? "CHECKOUT" : qualified ? "QUALIFIED" : outbound > 0 ? "ENGAGED" : "CONTACTED";
  return {
    reply: clip(reply, 1200),
    intent,
    signals: [...signals],
    qualified,
    suggestedStage,
    requestCheckout,
    handoffToHuman: handoff,
    handoffReason,
    sensitive: handoff && intent === "SUPPORT",
    followUpInHours: requestCheckout ? 24 : intent === "OBJECTION" ? 24 : 48,
    memory: {
      summary: clip(`${input.memory.summary ? input.memory.summary + " " : ""}${last?.body ? `Lead disse: "${clip(last.body, 80)}".` : ""}`, 1500),
      facts: input.memory.facts.slice(0, 15),
      needs: input.memory.needs.slice(0, 10),
      objections: [...input.memory.objections, ...(intent === "OBJECTION" ? [clip(last?.body ?? "", 200)] : [])].slice(-10),
      budget: input.memory.budget,
      intent,
      lastState: clip(requestCheckout ? "Checkout solicitado" : `Respondido (${intent})`, 300),
    },
  };
}
