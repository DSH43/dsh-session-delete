/**
 * dsh-session-delete —— client 半。
 *
 * 往会话行的「...」菜单注册一行「删除会话」（order 900，排在所有可逆操作后面）。
 * 点了先弹确认框，确认后 POST /plugins/dsh-session-delete/delete，成功再刷新
 * 会话列表。确认框用自建 DOM 覆盖层，不用 window.confirm，也不依赖 dsh 的
 * Modal —— 菜单关闭时本组件会被卸载，React 弹窗会跟着消失。
 *
 * 和 host 一样的约定：只走公开的 slots 和 fetch，不 import 任何 dsh 模块。
 * dsh 升级把 slot 或服务名改掉时，最坏结果是这一行不出现，不影响启动。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: function (require) {
    var React = require('react')
    var el = React.createElement

    var COPY = {
      zh: {
        menu: '删除会话',
        title: '永久删除此会话？',
        body: function (title) {
          return '“' + title + '”的会话日志、工作区记录和投影缓存会一起删除，无法恢复。只想移出列表的话用归档。'
        },
        cancel: '取消',
        confirm: '永久删除',
        forceTitle: '会话还在 Host 里，强制删除？',
        forceBody: function (title) {
          return '“' + title + '”没在跑，但仍被 Host 进程持有。强制删除会清掉磁盘上的日志、工作区记录和缓存；内存里的会话要重启 dsh 才彻底释放，期间它可能把投影缓存写回来。'
        },
        forceConfirm: '强制删除',
        failed: function (message) {
          return '删除失败：' + (message || '未知错误')
        },
      },
      en: {
        menu: 'Delete session',
        title: 'Permanently delete this session?',
        body: function (title) {
          return 'The log for “' + title + '”, its workspace record, and its projection cache will be deleted. This cannot be undone. Archive instead if you only want it out of the list.'
        },
        cancel: 'Cancel',
        confirm: 'Delete permanently',
        forceTitle: 'This session is still held by the Host. Force delete?',
        forceBody: function (title) {
          return '“' + title + '” is idle but still held by the Host process. Force delete removes the log, workspace record, and cache from disk; the in-memory session is released only after a dsh restart and may rewrite its cache file before then.'
        },
        forceConfirm: 'Force delete',
        failed: function (message) {
          return 'Delete failed: ' + (message || 'unknown error')
        },
      },
    }

    function copy() {
      var lang = String(document.documentElement.lang || '').toLowerCase()
      return lang.indexOf('zh') === 0 ? COPY.zh : COPY.en
    }

    function injectStyles() {
      var id = 'dsh-session-delete/styles'
      if (document.getElementById(id) !== null) return
      var style = document.createElement('style')
      style.id = id
      style.textContent = [
        // 几何跟 dsh 的 MenuItemButton 逐项对齐：min-height 34、padding 6/8、gap 6、图标 14。
        '.dsd-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;',
        '  padding:6px 8px;border:0;border-radius:var(--dsw-radius-md,8px);background:none;',
        '  color:var(--dsw-alias-state-error-primary,#f2555a);',
        '  font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
        '.dsd-item:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f2555a) 14%,transparent)}',
        '.dsd-icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center}',
        '.dsd-icon svg{width:14px;height:14px}',
        '.dsd-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsd-overlay{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;',
        '  justify-content:center;background:rgba(0,0,0,.45)}',
        '.dsd-card{width:min(440px,90vw);box-sizing:border-box;padding:20px;border-radius:12px;',
        '  background:var(--dsw-alias-bg-elevated,#232323);color:var(--dsw-alias-label-primary,#ededed);',
        '  box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:13px;line-height:1.6}',
        '.dsd-card h2{margin:0 0 10px;font-size:15px;font-weight:600}',
        '.dsd-card p{margin:0;color:var(--dsw-alias-label-secondary,#b8b8b8)}',
        '.dsd-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}',
        '.dsd-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#3a3a3a);',
        '  background:none;color:inherit;font:inherit;cursor:pointer}',
        '.dsd-btn:hover{background:rgba(255,255,255,.06)}',
        '.dsd-btn.dsd-danger{color:var(--dsw-alias-state-error-primary,#f2555a);',
        '  border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f2555a) 45%,transparent)}',
      ].join('\n')
      document.head.appendChild(style)
    }

    /** 自建确认框：返回 Promise<boolean>，Escape / 点遮罩算取消。 */
    function confirmDialog(options) {
      return new Promise(function (resolve) {
        var overlay = document.createElement('div')
        overlay.className = 'dsd-overlay'
        var card = document.createElement('div')
        card.className = 'dsd-card'
        card.setAttribute('role', 'dialog')
        card.setAttribute('aria-modal', 'true')

        var heading = document.createElement('h2')
        heading.textContent = options.title
        var body = document.createElement('p')
        body.textContent = options.body

        var actions = document.createElement('div')
        actions.className = 'dsd-actions'
        var cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.className = 'dsd-btn'
        cancel.textContent = options.cancelLabel
        var confirm = document.createElement('button')
        confirm.type = 'button'
        confirm.className = 'dsd-btn dsd-danger'
        confirm.textContent = options.confirmLabel

        function settle(value) {
          document.removeEventListener('keydown', onKey)
          overlay.remove()
          resolve(value)
        }
        function onKey(event) {
          if (event.key === 'Escape') settle(false)
        }

        cancel.addEventListener('click', function () { settle(false) })
        confirm.addEventListener('click', function () { settle(true) })
        overlay.addEventListener('click', function (event) {
          if (event.target === overlay) settle(false)
        })
        document.addEventListener('keydown', onKey)

        actions.appendChild(cancel)
        actions.appendChild(confirm)
        card.appendChild(heading)
        card.appendChild(body)
        card.appendChild(actions)
        overlay.appendChild(card)
        document.body.appendChild(overlay)
        confirm.focus()
      })
    }

    /** 与 dsh ui-primitives 的 IconTrashOutlineRegular 同一份画稿（16px / 1px 描边）。 */
    function trashIcon() {
      var stroke = 'currentColor'
      return el('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', strokeWidth: 1,
      },
      el('path', { d: 'M1.28149 3.88831H14.7187', stroke: stroke }),
      el('path', { d: 'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833', stroke: stroke }),
      el('path', { d: 'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831', stroke: stroke }),
      el('path', { d: 'M6.44946 6.98926V11.1238', stroke: stroke }),
      el('path', { d: 'M9.55054 6.98926V11.1238', stroke: stroke }))
    }

    return {
      name: 'dsh-session-delete',
      inject: ['slots'],
      apply: function (ctx) {
        var slots = ctx.get('slots')
        if (slots === undefined) return
        injectStyles()

        function requestDelete(sessionId, force) {
          var payload = force === true ? { sessionId: sessionId, force: true } : { sessionId: sessionId }
          return fetch('/plugins/dsh-session-delete/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).then(function (response) {
            return response.json().catch(function () { return {} }).then(function (data) {
              return { ok: response.ok, status: response.status, data: data }
            })
          })
        }

        function refreshSessions() {
          var sessions = ctx.get('sessions')
          if (sessions !== undefined && typeof sessions.refresh === 'function') void sessions.refresh()
        }

        function failureText(text, result) {
          return text.failed(result.data && (result.data.error || result.data.message))
        }

        function DeleteSessionMenuItem(props) {
          var text = copy()
          var setMenuOpen = props.useMenuOpenState()[1]
          function onSelect() {
            setMenuOpen(false)
            var title = props.displayTitle || props.sessionId
            void confirmDialog({
              title: text.title, body: text.body(title),
              cancelLabel: text.cancel, confirmLabel: text.confirm,
            }).then(function (confirmed) {
              if (!confirmed) return
              return requestDelete(props.sessionId, false).then(function (result) {
                if (result.ok) {
                  refreshSessions()
                  return
                }
                // Host 还挂着这条会话：问一次是否强制，强制也只删空闲会话。
                if (result.status === 409 && result.data && result.data.code === 'session/live') {
                  return confirmDialog({
                    title: text.forceTitle, body: text.forceBody(title),
                    cancelLabel: text.cancel, confirmLabel: text.forceConfirm,
                  }).then(function (forceConfirmed) {
                    if (!forceConfirmed) return
                    return requestDelete(props.sessionId, true).then(function (forced) {
                      if (forced.ok) refreshSessions()
                      else window.alert(failureText(text, forced))
                    })
                  })
                }
                window.alert(failureText(text, result))
              }).catch(function (error) {
                window.alert(text.failed(String(error)))
              })
            })
          }
          return el('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsd-item',
            title: text.menu,
            onClick: onSelect,
          },
          el('span', { className: 'dsd-icon' }, trashIcon()),
          el('span', { className: 'dsd-label' }, text.menu))
        }

        slots.inject('sidebar.workspaces.session.menu.item', function () {
          return slots.register({
            name: 'sidebar.workspaces.session.menu.item',
            id: 'dsh-session-delete',
            order: 900,
          }, DeleteSessionMenuItem)
        })
      },
    }
  },
})
