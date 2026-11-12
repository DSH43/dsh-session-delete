# dsh-session-delete

给 dsh Web 的会话行「…」菜单加一项**删除会话**。和归档不同，删除是真的删：

| 数据 | 位置 | 处理 |
| --- | --- | --- |
| 会话日志、写锁 | `$DSH_HOME/sessions/<项目>/<sessionId>/` | 整个目录删掉 |
| 工作区记账 | `$DSH_HOME/storages/workspace.json` 里的 `sessionIds` | 调工作区公开 API `detachSession` 摘掉 |
| 归档 / 置顶集合 | 同上 | 调注册表公开 API 摘掉 |
| 投影缓存 | `$DSH_HOME/storages/session_projcache/sessions/<sessionId>.json` | 连同 `.bak` 一起删 |
| 列表内存态 | 进程内 | 删除成功后客户端 `sessions.refresh()` |

不删：

- **附件**（`$DSH_HOME/attachments/`）：内容寻址、多会话共用，没有引用计数，删单个会话判断不了还有谁在用。
- **查询索引**：派生数据，下次读盘自行对账。

## 为什么是插件

它只依赖 dsh 的公开面：

- host：`webServer` 路由、`ctx.get('sessions')` 判活、`workspaceRegistry` 的
  `list()` / `detachSession()` / `unarchiveSession()` / `unpinSession()`、`dshHomePath()`、Node 的文件 API。
- client：`sidebar.workspaces.session.menu.item` slot、`ctx.get('sessions').refresh()`、`ctx.get('locale')` 的 `sessionDelete` 命名空间（菜单行和确认框中英双语，跟随界面语言）。

不 import 任何 dsh 内部模块、不改 dsh 源码，所以 dsh 升级不需要重打补丁。
`index.js` 是启动壳：host 加载失败只丢功能，不会把 dsh 启动拖死；client 注册失败
最坏是菜单里少一行。

## 安装

```bash
dsh plugin --profile web add "github:DSH43/dsh-session-delete#main"
```

改完重启 `dsh web`。已经在 `~/.dsh/profiles/web/package.json` 里登记过
（dependencies + bundles），profile 的 `cordis.patch.yml` 也有显式 insert。

## 快捷键

会话行「…」菜单打开后：

- 按 `D` 等于点「删除会话」，直接弹确认框；
- 确认框里确认按钮自动获得焦点，按空格即确认删除（Esc 或点遮罩取消）。

Ctrl / Cmd / Alt 组合键不拦截，输入框里按 D 也不触发。

## 只删冷会话

dsh 没有「结束会话」的按钮：打开过的会话会一直留在 Host 进程的 live store 里，
`SessionStore` 和 `AgentRegistry` 都没有按 id 释放它的公开接口。所以插件只删
磁盘上冷着的会话，还挂在进程里的一律拒绝（409 `session/live`），客户端提示
「重启 dsh 后再删」。

重启之后那条会话就只剩磁盘上的日志，删掉即干净，列表刷新后不会回来。

硬删 live 会话没意义：删的只是磁盘，内存里那条摘不掉，列表拉回来它还在；它下一次
落盘还会因为父目录没了而报 ENOENT。

## 谁能调这个接口

路由是 `webServer.register` 注册的裸路由，没有 dsh 那层鉴权，所以插件自己挡两道：

- `Sec-Fetch-Site` 必须是 `same-origin`（或没有这个头，本机进程用 curl 直连）。
  `cross-site`、`same-site` 一律 403。
- `Content-Type` 必须是 `application/json`，否则 415。跨站表单发不出这个类型。

两条合起来，只有 dsh 自己的页面能调。

## 限制

- 还挂在当前 dsh 进程里的会话删不了，要重启 dsh 再删。
- 多进程场景（CLI 和 Web 同时开）：插件只认自己所在进程的 live store。另一个进程
  里活着的会话在它看来是冷的，会被连磁盘一起删掉，那个进程随后落盘报错。同时开着
  两个 dsh 时别用这个功能。
- Session id 只做字符白名单校验（允许裸 UUID 的老会话），斜杠、点开头这类路径穿越
  写法一律拒绝。
