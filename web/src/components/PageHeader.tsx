import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
}

/** 页面统一标题区：标题 + 说明 + 右侧操作 */
export default function PageHeader({ title, description, extra }: PageHeaderProps) {
  return (
    <div className="liti-page-header">
      <div>
        <h1 className="liti-page-title">{title}</h1>
        {description && <p className="liti-page-desc">{description}</p>}
      </div>
      {extra && <div className="liti-page-extra">{extra}</div>}
    </div>
  );
}
