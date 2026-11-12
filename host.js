/**
 * dsh-session-delete —— host 半。给 dsh Web 的会话行菜单提供一个真正的「删除会话」。
 *
 * 和归档不同，删除会把这几个地方一次清掉：
 *   - $DSH_HOME/sessions/<项目>/<sessionId>/            会话日志和写锁
 *   - workspace.json 里所属工作区的 sessionIds 记账      （走公开 API detachSession）
 *   - 归档 / 置顶集合里的这个 id                         （走公开 API）
 *   - $DSH_HOME/storages/session_projcache/sessions/     投影缓存（含 .bak）
 *
 * 不删附件（attachments 是内容寻址、多会话共用，没有引用计数）；查询索引是
 * 派生数据，下次读盘自行对账。
 *
 * 正在运行的会话直接拒绝：它的写入句柄还开着，删了会被写回来。
 * 所有 dsh 服务都通过 ctx.get 软取，拿不到就不删对应部分，不会抛到启动路径。
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-session-delete'

/** 路由注册的前提；冷启动按依赖顺序挂载。 */
export const inject = ['webServer']

const ROUTE_PATH = '/plugins/dsh-session-delete/delete'
const MAX_BODY_BYTES = 4096
/** Session id 只允许安全字符，杜绝路径穿越。 */
const SESSION_ID = /^session-[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 写 JSON 响应；socket 已断开时吞掉。 */
function send(res, status, body) {
  try {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(body))
  } catch {
    // socket gone
  }
}

/** 读取有大小上限的 JSON 请求体。 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text === '' ? {} : JSON.parse(text)
}

/** 从一个工作区注册表里摘账；返回摘掉的记录数。 */
async function detachFromWorkspaces(registry, sessionId) {
  let detached = 0
  for (const workspace of registry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue
    await workspace.detachSession(sessionId)
    detached += 1
  }
  // 归档 / 置顶集合是注册表全局的；删掉的 id 留在里面会变成幽灵条目。
  try {
    await registry.unarchiveSession(sessionId)
  } catch {
    // 没归档过，或旧版本没有这个 API：都无所谓
  }
  try {
    await registry.unpinSession(sessionId)
  } catch {
    // 没置顶过，或旧版本没有这个 API：都无所谓
  }
  return detached
}

/** 删掉所有项目目录下的这个会话目录；返回是否删到了东西。 */
async function removeSessionDirs(sessionsRoot, sessionId) {
  let projects
  try {
    projects = await readdir(sessionsRoot)
  } catch {
    return false
  }
  let removed = false
  for (const project of projects) {
    const dir = join(sessionsRoot, project, sessionId)
    try {
      if (!(await stat(dir)).isDirectory()) continue
      await rm(dir, { recursive: true, force: true })
      removed = true
    } catch {
      // ENOENT：这个项目下没这条会话；权限等其他错误留给下一轮
    }
  }
  return removed
}

/** 删掉投影缓存记录和它的 .bak 备份。 */
async function removeProjectionCache(cacheDir, sessionId) {
  let entries
  try {
    entries = await readdir(cacheDir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry !== `${sessionId}.json` && !entry.startsWith(`${sessionId}.json.bak.`)) continue
    try {
      await rm(join(cacheDir, entry), { force: true })
    } catch {
      // 缓存是派生数据，删不掉也不影响正确性
    }
  }
}

/** 会话是否有正在执行的工作（回合、子智能体、后台任务、定时任务）。 */
async function sessionActivity(ctx, sessionId) {
  if (typeof ctx.waterfall !== 'function') return []
  try {
    return await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
  } catch {
    return []
  }
}

/** POST /plugins/dsh-session-delete/delete —— 永久删除一条会话。 */

async function handleDelete(req, res, ctx) {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'POST only' })
    return
  }
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    send(res, 400, { error: 'malformed JSON body' })
    return
  }
  const sessionId = body?.sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    send(res, 400, { error: 'invalid sessionId' })
    return
  }
  const force = body?.force === true
  const sessions = ctx.get('sessions')
  const live = sessions !== undefined && sessions.get(sessionId) !== undefined
  // Host 进程里还挂着这条会话：普通删除拒绝，让客户端来问一次「强制」。
  if (live && !force) {
    send(res, 409, { code: 'session/live', error: '会话还在 Host 进程里' })
    return
  }
  // 强制删除也不碰正在跑的工作：回合/子智能体/后台任务还在写日志。
  if (live) {
    const activity = await sessionActivity(ctx, sessionId)
    if (activity.length > 0) {
      send(res, 409, { code: 'session/active', error: '会话有正在执行的工作，先在会话里中断再删' })
      return
    }
  }
  // dsh 启动器会 provide dshHomePath；老/精简组合里没有就退回 DSH_HOME 或 ~/.dsh。
  const dshHomePath = ctx.get('dshHomePath')
  const home = typeof dshHomePath === 'function'
    ? dshHomePath()
    : (process.env.DSH_HOME || join(homedir(), '.dsh'))

  let detached = 0
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined) {
    try {
      detached = await detachFromWorkspaces(registry, sessionId)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-session-delete] detaching ${sessionId} failed: ${String(error)}`)
    }
  }

  const removed = await removeSessionDirs(join(home, 'sessions'), sessionId)
  await removeProjectionCache(join(home, 'storages', 'session_projcache', 'sessions'), sessionId)

  send(res, 200, { removed, detached })
}

/** 注册删除路由。 */
export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => {
      void handleDelete(req, res, ctx).catch((error) => {
        send(res, 500, { error: error instanceof Error ? error.message : String(error) })
      })
    },
  }), 'dsh-session-delete: delete route')
}
