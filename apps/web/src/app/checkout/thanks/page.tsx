export default async function Thanks({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const failed = status === "failed";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-center">
      <div className="max-w-sm">
        <div className="text-4xl">{failed ? "⚠️" : "🎉"}</div>
        <h1 className="mt-3 text-xl font-semibold">{failed ? "O pagamento não foi concluído" : "Obrigado!"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{failed ? "Você pode tentar novamente pelo mesmo link ou falar com a gente no WhatsApp." : "Assim que o pagamento for confirmado pela operadora, você recebe a confirmação no WhatsApp."}</p>
      </div>
    </main>
  );
}
