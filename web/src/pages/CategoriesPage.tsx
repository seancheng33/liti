import { Card } from 'antd';
import PageHeader from '../components/PageHeader';
import CategoryManager from '../components/CategoryManager';

export default function CategoriesPage() {
  return (
    <div className="liti-page">
      <PageHeader
        title="分类管理"
        description="题库按分类组织，组卷时可以指定从哪个分类随机抽题。管理员和教师都可以维护分类。"
      />
      <Card>
        <CategoryManager />
      </Card>
    </div>
  );
}
