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

## 限制

- 正在运行的会话不能删，Host 返回 409，先结束会话再删。
- 多进程场景（CLI 和 Web 同时开）：另一个进程手里活着的会话可能写回已删目录，
  这种情况升级/重启后再删一次。
- Session id 做了字符白名单校验，防路径穿越。
