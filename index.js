/**
 * dsh-session-delete 启动壳（boot shell）。
 *
 * 与 dsh-balance 同构：壳本身不 import 任何 dsh 核心模块、不做 IO，只负责
 * 运行时动态加载 ./host.js 并挂成子插件。host.js 加载或激活失败只丢功能，
 * dsh 照常启动 —— 这样 dsh 升级把插件打坏时，不会连带把一个能用的版本拖死。
 *
 * 约定：
 *  1. 壳必须极稳，任何异常都只能报告。
 *  2. 真正的逻辑都在 host.js，坏了大不了删不掉会话。
 *  3. 不声明 inject：loader 条目永远 ACTIVE；host.js 自己的 inject 在子 fiber 上生效。
 */

export const name = 'dsh-session-delete'

/** 真实插件模块，相对于本文件。 */
const HOST = './host.js'

/** 报告一次加载失败：插件停用，dsh 继续跑。这个函数自己不许抛。 */
function report(ctx, error) {
  try {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    const line = '[dsh-session-delete] host.js 加载失败，插件功能已停用，dsh 继续运行。原因：' + detail
    if (typeof ctx?.logger?.error === 'function') {
      ctx.logger.error('%s', line)
      return
    }
    console.error(line)
  } catch {
    // 报告本身失败也无所谓：绝不能因此变成新的启动故障点
  }
}

/**
 * 插件入口。同步返回，真正的加载丢给后台任务：壳的 fiber 立即 ACTIVE，
 * boot 不会等待这次动态导入。
 * @param {object} ctx - host context.
 */
export function apply(ctx) {
  void mount(ctx).catch(() => {})
}

/** 动态加载 host.js 并挂成子插件；任何失败只报告，不向外抛。 */
async function mount(ctx) {
  let loaded
  try {
    loaded = await import(HOST)
  } catch (error) {
    report(ctx, error)
    return
  }
  let fiber
  try {
    fiber = ctx.plugin(unwrap(loaded))
  } catch (error) {
    report(ctx, error)
    return
  }
  if (fiber !== undefined && typeof fiber.await === 'function') {
    // cordis 的 apply 在微任务里执行，失败记在子 fiber 上、由 await() 抛出。
    // 这里必须自己吞掉——漏出去会冒泡成父 fiber 的失败，那正是壳要挡的事。
    void fiber.await().catch((error) => report(ctx, error))
  }
}

/** 与 loader 的 unwrapExports 同形：解掉 default 与 esbuild 的 __esModule 包装。 */
function unwrap(exports) {
  if (exports === null || exports === undefined) return exports
  let value = exports.default ?? exports
  if (value.__esModule) value = value.default ?? value
  return value
}
