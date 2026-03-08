function joinClassNames(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function PanelSummaryRow({ className = '', children }) {
  return (
    <div className={joinClassNames('panel-summary-row', className)}>
      {children}
    </div>
  );
}

export function PanelSummaryBadge({ className = '', children }) {
  return (
    <span className={joinClassNames('panel-summary-badge', className)}>
      {children}
    </span>
  );
}

export function PanelSummaryText({ className = '', children }) {
  return (
    <span className={joinClassNames('panel-summary-text', className)}>
      {children}
    </span>
  );
}

export function PanelSummaryFeedback({ className = '', children, role, ariaLive }) {
  return (
    <span className={joinClassNames('panel-summary-feedback', className)} role={role} aria-live={ariaLive}>
      {children}
    </span>
  );
}

export function PanelSummaryActionButton({
  className = '',
  type = 'button',
  children,
  ...buttonProps
}) {
  return (
    <button type={type} className={joinClassNames('panel-summary-action', className)} {...buttonProps}>
      {children}
    </button>
  );
}

