import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { players, reports, wordPacks } from '../db/schema.js';
import { getEnv } from '../env.js';
import { sendError } from '../error-envelope.js';
import { performModerationAction, type ModerationActionKind } from '../moderation/actions.js';
import { readAdminStats } from '../services/stats.js';

const adminStatsResponseSchema = z.object({
  roomsActive: z.number().int(),
  socketsConnected: z.number().int(),
  gamesToday: z.number().int(),
  actionsPerMin: z.number().int(),
});

/**
 * Gates the admin endpoints on the `ADMIN_TOKEN` (api-contract.md §1 "Ops":
 * "admin token") — a bearer token DISTINCT from the player JWT (`requireAuth`),
 * so ops tooling never needs a game identity. Constant-time-ish compare via
 * length + value; a missing/wrong token is `unauthorized`. When `ADMIN_TOKEN`
 * is unset (production misconfig) the endpoint is closed, not open.
 */
async function requireAdminToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const configured = getEnv().adminToken;
  const header = request.headers.authorization;
  const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!configured || !presented || presented !== configured) {
    sendError(reply, 401, 'unauthorized', 'Admin access requires a valid admin token.');
  }
}

/**
 * Like `requireAdminToken` but also accepts the token via `?token=` query or a
 * form `token` field — the moderation queue (below) is a plain server-rendered
 * HTML page reached by BROWSER NAVIGATION, which can't set an `Authorization`
 * header. Ops-only page: the token appears in the URL / page HTML, acceptable
 * for a single-operator tool you already hold the token for, never used by
 * any player-facing surface.
 */
async function requireAdminAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const configured = getEnv().adminToken;
  const header = request.headers.authorization;
  const fromHeader = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const query = request.query as Record<string, unknown> | undefined;
  const body = request.body as Record<string, unknown> | undefined;
  const presented =
    fromHeader ??
    (typeof query?.token === 'string' ? query.token : undefined) ??
    (typeof body?.token === 'string' ? body.token : undefined);
  if (!configured || !presented || presented !== configured) {
    reply.code(401).type('text/html; charset=utf-8').send(page('Unauthorized', '<p>Admin access requires a valid admin token. Append <code>?token=…</code>.</p>'));
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Minimal self-contained HTML shell (no external assets — ops page). */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Sketchy admin</title><style>
    body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#faf7f2;color:#1c1917}
    h1{font-size:20px}
    .report{border:2px solid #1c1917;border-radius:10px;padding:14px 16px;margin:14px 0;background:#fff}
    .meta{color:#57534e;font-size:12px}
    .ctx{background:#f5f5f4;border-radius:6px;padding:8px 10px;margin:8px 0;white-space:pre-wrap;font-size:12px}
    form{display:inline-block;margin:0 6px 6px 0}
    button{font:inherit;padding:6px 10px;border:2px solid #1c1917;border-radius:6px;background:#fff;cursor:pointer}
    button:hover{background:#1c1917;color:#fff}
    input[name=packId]{font:inherit;padding:5px;border:1px solid #a8a29e;border-radius:4px}
    .empty{color:#57534e}
  </style></head><body>${body}</body></html>`;
}

interface ReportRow {
  id: string;
  reporterId: string;
  reportedId: string;
  roomCode: string | null;
  reason: string;
  detail: string;
  context: Record<string, unknown> | null;
  createdAt: Date;
}

function renderContext(context: Record<string, unknown> | null): string {
  if (!context) {
    return '';
  }
  const clues = Array.isArray(context.clues) ? (context.clues as { round?: number; playerName?: string; text?: string }[]) : [];
  const chat = Array.isArray(context.chat) ? (context.chat as { name?: string; text?: string }[]) : [];
  const cluesText = clues.map((c) => `R${esc(c.round)} ${esc(c.playerName)}: ${esc(c.text)}`).join('\n');
  const chatText = chat.map((c) => `${esc(c.name)}: ${esc(c.text)}`).join('\n');
  const parts: string[] = [];
  if (cluesText) {
    parts.push(`<div class="ctx"><strong>Recent clues</strong>\n${cluesText}</div>`);
  }
  if (chatText) {
    parts.push(`<div class="ctx"><strong>Recent chat</strong>\n${chatText}</div>`);
  }
  return parts.join('');
}

function renderReport(report: ReportRow, nameById: Map<string, string>, token: string): string {
  const reporter = esc(nameById.get(report.reporterId) ?? report.reporterId);
  const reported = esc(nameById.get(report.reportedId) ?? report.reportedId);
  const actionForm = (action: ModerationActionKind, label: string, extra = ''): string =>
    `<form method="post" action="/v1/admin/reports/${esc(report.id)}/action">
       <input type="hidden" name="token" value="${esc(token)}">
       <input type="hidden" name="action" value="${action}">${extra}
       <button>${esc(label)}</button>
     </form>`;
  return `<div class="report">
    <div><strong>${reported}</strong> reported by <strong>${reporter}</strong> — <em>${esc(report.reason)}</em></div>
    <div class="meta">${esc(report.createdAt.toISOString())}${report.roomCode ? ` · room ${esc(report.roomCode)}` : ''} · reported id ${esc(report.reportedId)}</div>
    ${report.detail ? `<div class="ctx">${esc(report.detail)}</div>` : ''}
    ${renderContext(report.context)}
    <div>
      ${actionForm('dismiss', 'Dismiss')}
      ${actionForm('warn', 'Warn')}
      ${actionForm('suspend', 'Suspend player')}
      ${actionForm('retire_pack', 'Retire pack', '<input name="packId" placeholder="pack id" size="34">')}
    </div>
  </div>`;
}

async function loadOpenReports(): Promise<{ rows: ReportRow[]; nameById: Map<string, string> }> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(reports)
    .where(eq(reports.status, 'open'))
    .orderBy(desc(reports.createdAt))
    .limit(100)) as ReportRow[];
  const ids = [...new Set(rows.flatMap((r) => [r.reporterId, r.reportedId]))];
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const named = await db
      .select({ id: players.id, displayName: players.displayName })
      .from(players)
      .where(inArray(players.id, ids));
    for (const p of named) {
      nameById.set(p.id, p.displayName);
    }
  }
  return { rows, nameById };
}

interface PendingPackRow {
  id: string;
  name: string;
  ownerId: string | null;
  pairCount: number;
  createdAt: Date;
}

/**
 * Packs an owner has requested to go public that are still awaiting review
 * (`visibility='public' AND review_status='pending'`). Until an admin approves one it's
 * invisible to every non-owner (routes/pack-access.ts), so this is the queue that keeps
 * legitimate public packs from being stuck in limbo.
 */
async function loadPendingPacks(): Promise<{ rows: PendingPackRow[]; nameById: Map<string, string> }> {
  const db = getDb();
  const rows = (await db
    .select({
      id: wordPacks.id,
      name: wordPacks.name,
      ownerId: wordPacks.ownerId,
      pairCount: wordPacks.pairCount,
      createdAt: wordPacks.createdAt,
    })
    .from(wordPacks)
    .where(and(eq(wordPacks.visibility, 'public'), eq(wordPacks.reviewStatus, 'pending')))
    .orderBy(asc(wordPacks.createdAt))
    .limit(100)) as PendingPackRow[];
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((id): id is string => id !== null))];
  const nameById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const named = await db
      .select({ id: players.id, displayName: players.displayName })
      .from(players)
      .where(inArray(players.id, ownerIds));
    for (const p of named) {
      nameById.set(p.id, p.displayName);
    }
  }
  return { rows, nameById };
}

function renderPendingPack(pack: PendingPackRow, nameById: Map<string, string>, token: string): string {
  const owner = pack.ownerId ? esc(nameById.get(pack.ownerId) ?? pack.ownerId) : 'unknown';
  return `<div class="report">
    <div><strong>${esc(pack.name)}</strong> — ${esc(pack.pairCount)} pair(s) · by <strong>${owner}</strong></div>
    <div class="meta">${esc(pack.createdAt.toISOString())} · pack id ${esc(pack.id)}</div>
    <div>
      <form method="post" action="/v1/admin/packs/${esc(pack.id)}/action">
        <input type="hidden" name="token" value="${esc(token)}">
        <input type="hidden" name="action" value="approve_pack">
        <button>Approve for public</button>
      </form>
    </div>
  </div>`;
}

const actionParamsSchema = z.object({ id: z.uuid() });
const actionBodySchema = z
  .object({ token: z.string().optional(), action: z.string().optional(), packId: z.string().optional() })
  .passthrough();

/** Report-scoped actions taken off the back of a player report (the `/admin/reports/:id/action` form). */
const MODERATION_ACTIONS = new Set<ModerationActionKind>(['dismiss', 'warn', 'suspend', 'retire_pack']);

/**
 * Ops stats endpoint (api-contract.md §1) + the
 * moderation queue. Every field of `/admin/stats` is a
 * COUNT — no words/roles/votes ever cross this boundary (conventions.md §1). The
 * moderation queue + action endpoints are hidden from the OpenAPI doc
 * (`schema.hide`) — they're server-rendered ops HTML, not part of the mobile
 * `/v1` contract.
 */
export const adminRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Scoped form-body parser so the moderation action POST (a plain HTML form)
  // reads its urlencoded fields — encapsulated to this plugin, no other route
  // accepts urlencoded (and no new dependency needed).
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  fastify.get(
    '/admin/stats',
    {
      preHandler: requireAdminToken,
      schema: {
        response: {
          200: adminStatsResponseSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async () => readAdminStats(),
  );

  fastify.get(
    '/admin/reports',
    {
      preHandler: requireAdminAccess,
      schema: { hide: true },
    },
    async (request, reply) => {
      const token = ((request.query as Record<string, unknown>)?.token as string | undefined) ?? '';
      const { rows, nameById } = await loadOpenReports();
      const list =
        rows.length === 0
          ? '<p class="empty">No open reports. A quiet, well-behaved table.</p>'
          : rows.map((r) => renderReport(r, nameById, token)).join('');

      const { rows: packs, nameById: packOwners } = await loadPendingPacks();
      const packList =
        packs.length === 0
          ? '<p class="empty">No packs awaiting review.</p>'
          : packs.map((p) => renderPendingPack(p, packOwners, token)).join('');

      reply
        .type('text/html; charset=utf-8')
        .send(
          page(
            'Reports queue',
            `<h1>Reports queue (${rows.length} open)</h1>${list}` +
              `<h1>Packs awaiting review (${packs.length})</h1>${packList}`,
          ),
        );
    },
  );

  fastify.post(
    '/admin/reports/:id/action',
    {
      preHandler: requireAdminAccess,
      schema: { hide: true, params: actionParamsSchema, body: actionBodySchema },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof actionBodySchema>;
      const query = request.query as Record<string, unknown>;
      const token = body.token ?? (typeof query.token === 'string' ? query.token : '') ?? '';
      const rawAction = body.action ?? (typeof query.action === 'string' ? query.action : undefined);
      const packId = body.packId ?? (typeof query.packId === 'string' ? query.packId : undefined);

      if (!rawAction || !MODERATION_ACTIONS.has(rawAction as ModerationActionKind)) {
        reply.code(400).type('text/html; charset=utf-8').send(page('Bad action', '<p>Unknown moderation action.</p>'));
        return;
      }

      const result = await performModerationAction({
        action: rawAction as ModerationActionKind,
        reportId: request.params.id,
        packId: packId && packId.length > 0 ? packId : undefined,
      });
      if (!result.ok) {
        reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(page('Action failed', `<p>${esc(result.error)}</p><p><a href="/v1/admin/reports?token=${esc(token)}">Back to queue</a></p>`));
        return;
      }
      // Redirect back to the queue (PRG pattern) so a refresh doesn't re-submit.
      reply.redirect(`/v1/admin/reports?token=${encodeURIComponent(token)}`);
    },
  );

  // Pack-scoped moderation action (the "Packs awaiting review" section). Standalone —
  // acts on a pack directly, not off a report — so it takes the PACK id in the path and
  // never touches the reports table. `approve_pack` is the only action offered here today.
  fastify.post(
    '/admin/packs/:id/action',
    {
      preHandler: requireAdminAccess,
      schema: { hide: true, params: actionParamsSchema, body: actionBodySchema },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof actionBodySchema>;
      const query = request.query as Record<string, unknown>;
      const token = body.token ?? (typeof query.token === 'string' ? query.token : '') ?? '';
      const rawAction = body.action ?? (typeof query.action === 'string' ? query.action : undefined);

      if (rawAction !== 'approve_pack') {
        reply.code(400).type('text/html; charset=utf-8').send(page('Bad action', '<p>Unknown pack action.</p>'));
        return;
      }

      const result = await performModerationAction({ action: 'approve_pack', packId: request.params.id });
      if (!result.ok) {
        reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(page('Action failed', `<p>${esc(result.error)}</p><p><a href="/v1/admin/reports?token=${esc(token)}">Back to queue</a></p>`));
        return;
      }
      reply.redirect(`/v1/admin/reports?token=${encodeURIComponent(token)}`);
    },
  );
};
