"use client";
import { useState, useTransition } from "react";
import { submitLeadForm } from "@/server/actions/public";

export function LeadForm({ slug, refCode, color }: { slug: string; refCode: string | null; color: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <div className="mt-6 rounded-xl bg-white/10 p-5 text-center text-sm">Recebemos seu contato! Vamos responder no seu WhatsApp em instantes. 🙌</div>;
  return (
    <form
      className="mt-6 grid gap-3"
      action={(fd) =>
        start(async () => {
          setError(null);
          const r = await submitLeadForm({ slug, name: fd.get("name"), phone: fd.get("phone"), message: fd.get("message") ?? "", ref: refCode, consent: fd.get("consent") === "on" });
          if (r.ok) setDone(true);
          else setError(r.error);
        })
      }
    >
      <input name="name" required placeholder="Seu nome" className="h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-sm outline-none placeholder:text-white/40 focus:border-white/40" />
      <input name="phone" required inputMode="tel" placeholder="WhatsApp com DDD" className="h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-sm outline-none placeholder:text-white/40 focus:border-white/40" />
      <textarea name="message" rows={3} placeholder="Como podemos ajudar? (opcional)" className="rounded-lg border border-white/15 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 focus:border-white/40" />
      <label className="flex items-start gap-2 text-xs opacity-80">
        <input type="checkbox" name="consent" required className="mt-0.5" /> Aceito ser contatado(a) pelo WhatsApp sobre este atendimento.
      </label>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <button disabled={pending} className="h-11 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ background: color }}>
        {pending ? "Enviando…" : "Quero falar com vocês"}
      </button>
    </form>
  );
}
