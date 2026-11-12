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
- client：`sidebar.workspaces.session.menu.item` slot、`ctx.get('sessions').refresh()`。

不 import 任何 dsh 内部模块、不改 dsh 源码，所以 dsh 升级不需要重打补丁。
`index.js` 是启动壳：host 加载失败只丢功能，不会把 dsh 启动拖死；client 注册失败
最坏是菜单里少一行。

## 安装

```bash
dsh plugin --profile web add "github:DSH43/dsh-session-delete#main"
```

改完重启 `dsh web`。已经在 `~/.dsh/profiles/web/package.json` 里登记过
（dependencies + bundles），profile 的 `cordis.patch.yml` 也有显式 insert。

## 删除还挂在 Host 里的会话

dsh 没有「结束会话」的按钮：打开过的会话会一直留在 Host 进程的 live store 里。
第一次删除会返回 409，确认后插件带 `force: true` 再发一次：

- 没有正在跑的工作（回合、子智能体、后台任务、定时任务）→ 强制删除，磁盘数据照删；
- 有正在跑的工作 → 拒绝，先在会话里中断。

## 限制

- 强制删除只清磁盘。Host 内存里的那条会话要重启 dsh 才彻底释放；释放时它可能把
  `session_projcache` 的缓存文件写回来一次（删掉即可）。
- 真正在跑回合/子智能体的会话不能强制删，插件不碰正在写的日志。
- 多进程场景（CLI 和 Web 同时开）：另一个进程手里活着的会话可能写回已删目录，
  这种情况升级/重启后再删一次。
- Session id 做了字符白名单校验，防路径穿越。
