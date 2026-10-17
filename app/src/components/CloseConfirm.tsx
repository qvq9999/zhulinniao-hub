import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { isTauri } from '../device/deviceDetect';
import {
  errText,
  onCloseRequested,
  tauriSetCloseAction,
  tauriWindowAction,
  type CloseAction,
} from '../device/tauriBridge';
import { useSetting } from '../state/settings';

/**
 * 关闭确认弹窗 —— 点窗口 × 后的三选一：
 *   最小化到后台（隐藏 + 托盘）/ 关闭程序 / 取消。
 *
 * 只在「每次询问」策略下由后端事件 `hub://window/close-requested` 触发；
 * 其余两种策略由后端直接执行，不经过本组件。
 *
 * 读取与写入共用 settings.json 的 `closeAction` 键，与「设置 → 关闭窗口时」是同一个值，
 * 所以弹窗里的「记住我的选择」等价于在设置页改这项。
 */
export default function CloseConfirm() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [closeAction, setCloseAction, ready] = useSetting<CloseAction>('closeAction', 'ask');
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // 把当前策略同步给后端（决定 × 是「直接关」还是「先问」）
  useEffect(() => {
    if (!isTauri() || !ready) return;
    void tauriSetCloseAction(closeAction).catch(() => {
      /* 浏览器预览/旧版后端：忽略 */
    });
  }, [closeAction, ready]);

  // 订阅后端「用户点了 ×」
  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void onCloseRequested(() => {
      setError(null);
      setOpen(true);
    }).then((fn) => {
      if (cancelled) fn();
      else dispose = fn;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // 打开时聚焦弹窗，Esc 取消
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        void tauriWindowAction('cancel').catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const choose = useCallback(
    async (action: 'minimize' | 'exit') => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        if (remember) {
          // 交给设置层落盘（localStorage + settings.json），并触发同步到后端；
          // 这样「设置 → 关闭窗口时」会立即显示同一结果，不是两套状态。
          setCloseAction(action);
        }
        setOpen(false);
        await tauriWindowAction(action);
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, remember, setCloseAction],
  );

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => {
        setOpen(false);
        void tauriWindowAction('cancel').catch(() => {});
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-dialog-title"
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title" id="close-dialog-title">
            关闭朱雀耳机 Hub？
          </h2>
          <button
            type="button"
            className="modal__close"
            aria-label="取消关闭"
            onClick={() => {
              setOpen(false);
              void tauriWindowAction('cancel').catch(() => {});
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <p className="modal__desc">
          选择如何结束本次使用。最小化到后台后程序继续运行，可从任务栏托盘的耳机图标重新打开。
        </p>

        <label className="modal__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>记住我的选择（之后可在「设置 → 关闭窗口时」修改）</span>
        </label>

        {error && (
          <p className="modal__error">
            <span className="pill pill--warn">{error}</span>
          </p>
        )}

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              void tauriWindowAction('cancel').catch(() => {});
            }}
          >
            取消
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void choose('exit')}>
            关闭程序
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void choose('minimize')}>
            最小化到后台
          </button>
        </div>
      </div>
    </div>
  );
}
