import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { contentPerformance, currentSpec } from "@revenueos/core";
import { activities, and, brandAssets, contents, desc, eq, inArray, isUuid, leads, socialPosts, videoRenders, videoSpecs, withUser } from "@revenueos/database";
import { ActivityFeed } from "@/components/activity-feed";
import { ContentActions } from "@/components/content/content-actions";
import { RetryPostButton } from "@/components/content/retry-post";
import { SpecEditor } from "@/components/content/spec-editor";
import { VideoPreview } from "@/components/content/video-player";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { CONTENT_STATUS, LEAD_STAGE, POST_STATUS } from "@/lib/status";
import { ago, compact, dateTime, money, pct } from "@/lib/utils";
import { signedUrl, signedUrls } from "@/server/files";
import { workerStatuses } from "@/server/queries";
import { requireWorkspace } from "@/server/session";

export default async function ContentDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!isUuid(id)) notFound();
  const { user, ws } = await requireWorkspace(slug);
  const data = await withUser(user.id, async (tx) => {
    const [c] = await tx.select().from(contents).where(and(eq(contents.id, id), eq(contents.workspaceId, ws.id))).limit(1);
    if (!c) return null;
    const renders = await tx.select().from(videoRenders).where(eq(videoRenders.contentId, id)).orderBy(desc(videoRenders.createdAt)).limit(5);
    const posts = await tx.select().from(socialPosts).where(eq(socialPosts.contentId, id)).orderBy(socialPosts.platform);
    const leadRows = await tx.select().from(leads).where(eq(leads.sourceContentId, id)).orderBy(desc(leads.createdAt)).limit(20);
    const versions = await tx.select({ id: videoSpecs.id, version: videoSpecs.version, createdBy: videoSpecs.createdBy, createdAt: videoSpecs.createdAt, promptVersion: videoSpecs.promptVersion }).from(videoSpecs).where(eq(videoSpecs.contentId, id)).orderBy(desc(videoSpecs.version));
    const history = await tx.select().from(activities).where(and(eq(activities.workspaceId, ws.id), eq(activities.entityId, id))).orderBy(desc(activities.createdAt)).limit(30);
    return { c, renders, posts, leadRows, versions, history };
  });
  if (!data) notFound();
  const { c, renders, posts, leadRows, versions, history } = data;
  const cur = await currentSpec(id);
  const spec = cur?.spec ?? null;
  const [perf] = c.status === "PUBLISHED" ? await contentPerformance([ws.id], { contentIds: [id] }) : [];
  const assetRows = spec?.assets.length
    ? await withUser(user.id, (tx) => tx.select({ id: brandAssets.id, key: brandAssets.storageKey }).from(brandAssets).where(and(eq(brandAssets.workspaceId, ws.id), inArray(brandAssets.id, spec.assets.map((a) => a.id)))))
    : [];
  const assetUrls = await signedUrls(assetRows.map((a) => a.key));
  const assets = Object.fromEntries(assetRows.map((a, i) => [a.id, assetUrls[i] ?? ""]).filter(([, u]) => u));
  const render = renders.find((r) => r.status === "COMPLETED") ?? renders[0] ?? null;
  const videoUrl = render?.previewKey ? await signedUrl(render.previewKey) : render?.deliveryKey && !render.deliveryDeletedAt ? await signedUrl(render.deliveryKey) : null;
  const worker = (await workerStatuses()).find((w) => w.online && w.localUiUrl);
  const localUrl = render?.status === "COMPLETED" && render.localPath && !render.localDeletedAt && worker?.localUiUrl ? `${worker.localUiUrl}/renders/${render.id}` : null;
  const poster = await signedUrl(render?.thumbnailKey);
  const frames = await signedUrls(render?.frameKeys ?? []);
  const copy = c.copy;
  const qa = c.qaReport?.checks ?? [];

  return (
    <div>
      <Link href={`/w/${slug}/content`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Content Studio
      </Link>
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <VideoPreview spec={spec} assets={assets} videoUrl={videoUrl} localUrl={localUrl} poster={poster} />
          {render ? (
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-[11px] text-muted-foreground">
              <span>Render</span>
              <span className="text-right text-foreground">
                <StatusBadge map={{ COMPLETED: { label: "Completed", tone: "success" }, SIMULATED: { label: "Simulated (demo)", tone: "info" }, FAILED: { label: "Failed", tone: "danger" }, RENDERING: { label: "Rendering", tone: "primary" }, QUEUED: { label: "Queued", tone: "neutral" } }} value={render.status} />
              </span>
              <span>Resolution</span>
              <span className="tabular text-right text-foreground">{render.width && render.height ? `${render.width}×${render.height}` : "—"}</span>
              <span>Duration</span>
              <span className="tabular text-right text-foreground">{render.durationMs ? `${(render.durationMs / 1000).toFixed(1)}s` : "—"}</span>
              <span>Codec</span>
              <span className="text-right text-foreground">{render.videoCodec ? `${render.videoCodec}${render.audioCodec ? ` / ${render.audioCodec}` : ""}` : "—"}</span>
              <span>File size</span>
              <span className="tabular text-right text-foreground">{render.fileSize ? `${(render.fileSize / 1e6).toFixed(1)} MB` : "—"}</span>
              <span>Render time</span>
              <span className="tabular text-right text-foreground">{render.renderMs ? `${(render.renderMs / 1000).toFixed(1)}s` : "—"}</span>
              <span>Worker</span>
              <span className="truncate text-right text-foreground">{render.workerId ?? "—"}</span>
              {render.localPath ? (
                <>
                  <span>Local file</span>
                  <span className="truncate text-right font-mono text-foreground" title={render.localPath}>
                    {render.localDeletedAt ? "deleted by retention" : render.localPath.split(/[\\/]/).slice(-2).join("/")}
                  </span>
                </>
              ) : null}
              {render.error ? <span className="col-span-2 text-danger">{render.error}</span> : null}
            </div>
          ) : null}
          {frames.filter(Boolean).length ? (
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">QA frames</div>
              <div className="grid grid-cols-4 gap-1.5">
                {frames.map((f, i) =>
                  f ? (
                    <img key={i} src={f} alt={`Frame ${i + 1}`} className="aspect-[9/16] w-full rounded object-cover ring-1 ring-border" loading="lazy" />
                  ) : null,
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="tabular">#{c.number}</span>
              <StatusBadge map={CONTENT_STATUS} value={c.status} />
              <Badge tone={c.qaStatus === "PASSED" ? "success" : c.qaStatus === "FAILED" ? "danger" : c.qaStatus === "WARNINGS" ? "warning" : "neutral"}>QA {c.qaStatus.toLowerCase()}</Badge>
              {c.approvalStatus === "PENDING" ? <Badge tone="warning">Waiting approval</Badge> : null}
              {c.isDemo ? <Badge tone="info">DEMO</Badge> : null}
              <span>· {c.createdBy === "AGENT" ? "created by agents" : "created by you"} · {ago(c.createdAt)}</span>
            </div>
            <h2 className="mt-2 text-xl leading-snug font-semibold tracking-[-0.02em]">{c.hook ?? c.title}</h2>
            <div className="mt-1 text-[13px] text-muted-foreground">
              {[c.templateId?.replace(/_/g, " ").toLowerCase(), c.format, c.durationSec ? `${c.durationSec.toFixed(0)}s` : null, c.hookType?.toLowerCase(), c.angle].filter(Boolean).join(" · ")}
              {c.scheduledFor ? ` · scheduled ${dateTime(c.scheduledFor, ws.timezone)}` : ""}
              {c.publishedAt ? ` · published ${dateTime(c.publishedAt, ws.timezone)}` : ""}
            </div>
            {c.failureReason ? <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">{c.failureReason}</div> : null}
          </div>
          <ContentActions id={c.id} status={c.status} approvalStatus={c.approvalStatus} hasSpec={Boolean(spec)} downloadUrl={videoUrl} isDemo={c.isDemo} />

          {perf ? (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
              {[
                ["Views", perf.views == null ? "—" : compact(perf.views)],
                ["Clicks", String(perf.clicks)],
                ["Leads", String(perf.leads)],
                ["Qualified", String(perf.qualifiedLeads)],
                ["Sales", String(perf.sales)],
                ["Revenue", money(perf.revenueCents, ws.currency)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-card p-3">
                  <div className="text-[11px] text-muted-foreground">{k}</div>
                  <div className="tabular mt-1 text-base font-semibold">{v}</div>
                </div>
              ))}
              <div className="col-span-3 text-[11px] text-subtle md:col-span-6">
                Lead rate {pct(perf.leadPerView, 2)} · sale per lead {pct(perf.salePerLead)} · revenue per 1k views {perf.revenuePer1kViews == null ? "—" : money(Math.round(perf.revenuePer1kViews), ws.currency)} — attributed, observational.
              </div>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Publication</CardTitle>
                <CardDescription>One post per platform, each with its own tracked link and AI-generated content label.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2">
              {posts.length === 0 ? (
                <p className="px-3 pb-2 text-sm text-muted-foreground">Not scheduled yet. Posts are created when the content is scheduled.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Platform</TH>
                      <TH>Status</TH>
                      <TH>When</TH>
                      <TH>Link code</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {posts.map((p) => (
                      <TR key={p.id}>
                        <TD>
                          <div className="flex items-center gap-2">
                            <PlatformIcon platform={p.platform} size={18} />
                            <span className="text-[13px]">{platformLabel(p.platform)}</span>
                            {p.isDemo ? <Badge tone="info">demo</Badge> : null}
                          </div>
                        </TD>
                        <TD>
                          <StatusBadge map={POST_STATUS} value={p.status} />
                          {p.privacy && p.privacy !== "PUBLIC_TO_EVERYONE" && p.privacy !== "public" ? <span className="ml-1 text-[11px] text-warning">{p.privacy.toLowerCase().replace(/_/g, " ")}</span> : null}
                          {p.lastError ? <div className="mt-1 max-w-xs text-[11px] text-danger">{p.lastError}</div> : null}
                        </TD>
                        <TD className="text-[12px] text-muted-foreground">{p.publishedAt ? dateTime(p.publishedAt, ws.timezone) : p.scheduledFor ? dateTime(p.scheduledFor, ws.timezone) : "—"}</TD>
                        <TD className="font-mono text-[12px]">{p.trackedLinkCode ?? "—"}</TD>
                        <TD className="text-right">
                          {p.permalink ? (
                            <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                              Open <ExternalLink className="size-3" />
                            </a>
                          ) : p.status === "FAILED" || p.status === "CANCELLED" ? (
                            <RetryPostButton id={p.id} />
                          ) : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {copy ? (
            <Card>
              <CardHeader>
                <CardTitle>Copy per platform</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                    <PlatformIcon platform="INSTAGRAM" size={16} /> Instagram
                  </div>
                  <p className="text-[13px] whitespace-pre-wrap">{copy.instagram.caption}</p>
                  <p className="mt-1 text-[12px] text-info">{copy.instagram.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                    <PlatformIcon platform="TIKTOK" size={16} /> TikTok
                  </div>
                  <p className="text-[13px] whitespace-pre-wrap">{copy.tiktok.caption}</p>
                  <p className="mt-1 text-[12px] text-info">{copy.tiktok.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                    <PlatformIcon platform="YOUTUBE" size={16} /> YouTube Shorts
                  </div>
                  <p className="text-[13px] font-medium">{copy.youtube.title}</p>
                  <p className="mt-1 text-[13px] whitespace-pre-wrap text-muted-foreground">{copy.youtube.description}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                    <PlatformIcon platform="FACEBOOK" size={16} /> Facebook
                  </div>
                  <p className="text-[13px] whitespace-pre-wrap">{copy.facebook.caption}</p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {spec ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Edit video</CardTitle>
                  <CardDescription>
                    VideoSpec v{versions[0]?.version ?? 1} · {spec.templateId.replace(/_/g, " ").toLowerCase()} · {spec.scenes.length} scenes · {spec.duration}s. Edits are validated, versioned and re-rendered.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <SpecEditor contentId={c.id} spec={spec} readOnly={c.status === "PUBLISHED" || c.status === "PUBLISHING"} />
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Quality check</CardTitle>
                  <CardDescription>Duration, text overflow, safe zones, assets, blank frames, CTA, captions, duplicates, file integrity</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {qa.length === 0 ? <p className="text-sm text-muted-foreground">Runs after rendering.</p> : null}
                {qa.map((q) => (
                  <div key={q.id} className="flex items-start gap-2 text-[13px]">
                    <Badge tone={q.status === "pass" ? "success" : q.status === "warn" ? "warning" : "danger"}>{q.status}</Badge>
                    <span className="leading-snug">{q.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Strategy & script</CardTitle>
                  <CardDescription>Why the Strategist created this video</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-[13px]">
                {c.brief ? (
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
                    <dt className="text-muted-foreground">Objective</dt>
                    <dd>{c.objective}</dd>
                    <dt className="text-muted-foreground">Angle</dt>
                    <dd>{c.brief.angle}</dd>
                    <dt className="text-muted-foreground">Key message</dt>
                    <dd>{c.brief.keyMessage}</dd>
                    <dt className="text-muted-foreground">Rationale</dt>
                    <dd>{c.brief.rationale}</dd>
                    <dt className="text-muted-foreground">CTA</dt>
                    <dd>{c.cta}</dd>
                  </dl>
                ) : null}
                {c.script ? <p className="rounded-lg bg-muted/50 p-3 whitespace-pre-wrap text-muted-foreground">{c.script}</p> : null}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Leads from this video</CardTitle>
                  <CardDescription>Attributed by tracked link, reference code or platform referral</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {leadRows.length === 0 ? <p className="text-sm text-muted-foreground">No leads attributed yet.</p> : null}
                {leadRows.map((l) => (
                  <Link key={l.id} href={`/w/${slug}/crm/${l.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                    <span className="truncate text-[13px]">{l.name || l.phone || "Lead"}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-subtle">{l.attributionModel.toLowerCase().replace(/_/g, " ")}</span>
                      <StatusBadge map={LEAD_STAGE} value={l.stage} />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>History</CardTitle>
                  <CardDescription>
                    {versions.length} VideoSpec version{versions.length === 1 ? "" : "s"}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="max-h-80 overflow-y-auto px-3">
                <ActivityFeed items={history.map((a) => ({ a }))} workspace slugOf={slug} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
