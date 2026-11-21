import app from './http'
import { purge } from './privacy'
import { drainMessenger } from './messenger'
import type { Env } from './http'
export type { Env, Variables } from './http'

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env) {
    // One workspace retention batch and one Page per tick keep Free-plan DB work bounded.
    // Durable cursors rotate fairly instead of restarting at the first workspace/Page.
    const nextWorkspace=await env.DB.prepare(`SELECT id FROM brands ORDER BY
      (id>coalesce((SELECT cursor FROM scheduler_cursors WHERE name='retention'),'')) DESC,id LIMIT 1`).first<{id:string}>()
    if (nextWorkspace) {
      await purge(env.DB,nextWorkspace.id)
      await env.DB.prepare("INSERT INTO scheduler_cursors VALUES ('retention',?) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor").bind(nextWorkspace.id).run()
    }
    const page=await env.DB.prepare(`SELECT * FROM (
      SELECT c.id cursor_id,c.id,c.brand_id,c.mock FROM channels c JOIN brands b ON b.id=c.brand_id
      WHERE b.active=1 AND c.kind='messenger' AND c.state='connected' AND c.paused=0 AND (c.mock=1 OR c.verified=1) AND (?=0 OR c.mock=1)
      AND EXISTS(SELECT 1 FROM messenger_outbox o WHERE o.brand_id=c.brand_id AND o.connection_id=c.id AND o.state IN ('queued','retry','working','sending') AND o.due<=?)
      UNION ALL
      SELECT 'legacy-mock:'||b.id,NULL,b.id,1 FROM brands b WHERE b.active=1 AND EXISTS(
        SELECT 1 FROM messenger_outbox o WHERE o.brand_id=b.id AND o.connection_id IS NULL AND o.channel='messenger-mock' AND o.state IN ('queued','retry','working','sending') AND o.due<=?)
      ) ORDER BY (cursor_id>coalesce((SELECT cursor FROM scheduler_cursors WHERE name='delivery'),'')) DESC,cursor_id LIMIT 1`)
      .bind(Number(env.STUDIO_ENV==='staging'),Date.now(),Date.now()).first<{cursor_id:string;id:string|null;brand_id:string;mock:number}>()
    if (page) {
      await drainMessenger({ ...env,BRAND_ID:page.brand_id },page.mock ? 'messenger-mock' : 'messenger',1,fetch,page.id??undefined)
      await env.DB.prepare("INSERT INTO scheduler_cursors VALUES ('delivery',?) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor").bind(page.cursor_id).run()
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM account_sessions WHERE expires<=?').bind(Date.now()),
      env.DB.prepare('DELETE FROM platform_login_attempts WHERE expires<=?').bind(Date.now()),
      env.DB.prepare("DELETE FROM inference_reservations WHERE day<date('now','-7 days')"),
    ])
  },
}
