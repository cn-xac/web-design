/**
 * 通用弹窗外壳（对齐 Vue 的 ModalShell.vue）。
 *
 * 设计器不绑定任何 UI 库（换 Element Plus / antd 都不该改引擎），
 * 所以弹窗自己用原生 DOM 实现：遮罩 + 面板 + ESC 关闭。
 * 需要 UI 库观感一致的适配包可以自行覆盖弹窗组件。
 */
import { useEffect } from "react";
import type { MouseEvent, ReactNode } from "react";

export interface ModalShellProps {
  title: string;
  /** 面板宽度，缺省 520px（与 Vue 侧一致） */
  width?: string;
  onClose: () => void;
  children: ReactNode;
  /** 底栏动作区；不传则不渲染 footer */
  footer?: ReactNode;
  /** 叠加二级弹窗时，外层置 false，避免一次 ESC 关掉两层并丢失未保存草稿 */
  escToClose?: boolean;
}

export function ModalShell({ title, width = "520px", onClose, children, footer, escToClose = true }: ModalShellProps) {
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      if (escToClose && event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [onClose, escToClose]);

  /** 点遮罩关闭：只有直接落在遮罩上才算，面板内部点击不触发 */
  const onBackdrop = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="wbd-modal" onClick={onBackdrop}>
      <div className="wbd-modal__panel" style={{ width }}>
        <header className="wbd-modal__head">
          <span className="wbd-modal__title">{title}</span>
          <button type="button" className="wbd-modal__close" title="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="wbd-modal__body wb-scroll">{children}</div>
        {footer ? <footer className="wbd-modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
