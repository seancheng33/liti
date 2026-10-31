import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import { BookOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';
import type { Category, WrongQuestion, WrongSummary } from '../types';

const { Text } = Typography;

/** 把「总题量」平均分到选中的分类上（余数给排在前面的分类） */
function splitRules(total: number, categoryIds: number[]): { categoryId: number | null; count: number }[] {
  if (!categoryIds.length) return [{ categoryId: null, count: total }];
  const base = Math.floor(total / categoryIds.length);
  const rest = total % categoryIds.length;
  const rules = categoryIds.map((id, i) => ({ categoryId: id as number | null, count: base + (i < rest ? 1 : 0) }));
  return rules.filter((r) => r.count > 0);
}

export default function PracticePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<WrongSummary | null>(null);
  const [recent, setRecent] = useState<WrongQuestion[]>([]);
  const [practiceEnabled, setPracticeEnabled] = useState(true);
  const [starting, setStarting] = useState<'random' | 'wrong' | null>(null);

  const [randomForm] = Form.useForm();
  const [wrongForm] = Form.useForm();
  const [randomCats, setRandomCats] = useState<number[]>([]);
  const [randomCount, setRandomCount] = useState(10);

  const load = useCallback(async () => {
    try {
      const [cats, sum, list, settings] = await Promise.all([
        api.get<Category[]>('/api/categories'),
        api.get<WrongSummary>('/api/wrong-questions/summary'),
        api.get<{ items: WrongQuestion[] }>('/api/wrong-questions?pageSize=5'),
        api.get<{ practiceEnabled: boolean }>('/api/settings/public').catch(() => ({ practiceEnabled: true })),
      ]);
      setCategories(cats);
      setSummary(sum);
      setRecent(list.items);
      // /api/settings/public 只返回站名公告，取不到就用完整设置（学生没权限，兜底 true）
      setPracticeEnabled(settings.practiceEnabled !== false);
    } catch (e) {
      message.error((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rulesPreview = useMemo(() => splitRules(randomCount, randomCats), [randomCount, randomCats]);
  const activeTotal = summary?.activeTotal ?? 0;

  // 错题练习的题量默认取「10 与错题数的较小值」：错题只有 3 道时默认 10 会一点就报错
  useEffect(() => {
    if (!summary) return;
    wrongForm.setFieldsValue({ count: Math.max(1, Math.min(10, summary.activeTotal)) });
  }, [summary, wrongForm]);

  async function start(source: 'random' | 'wrong') {
    setStarting(source);
    try {
      let payload: Record<string, unknown>;
      if (source === 'random') {
        const v = await randomForm.validateFields();
        payload = { source: 'random', rules: splitRules(v.count, v.categoryIds ?? []), durationSec: v.durationMin * 60 };
      } else {
        const v = await wrongForm.validateFields();
        payload = {
          source: 'wrong',
          count: v.count,
          categoryId: v.categoryId ?? null,
          durationSec: v.durationMin * 60,
        };
      }
      const res = await api.post<{ id: number }>('/api/attempts/practice', payload);
      message.success('练习卷已生成，开始计时');
      navigate(`/exam/${res.id}`);
    } catch (e) {
      // validateFields 失败时抛的是对象，别当错误弹
      const err = e as { errorFields?: unknown; message?: string };
      if (!err.errorFields) message.error(err.message ?? '生成练习卷失败');
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="liti-page">
      <PageHeader
        title="练习中心"
        description="自己抽题练手：可以按分类随机抽，也可以专门练自己的错题。练习卷不计入「每卷 3 次」的限制，交完立刻能看解析。"
      />

      {!practiceEnabled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="本站已关闭学生自助练习"
          description="需要练习可以找老师要练习卷。错题本仍然可以查看。"
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic
              title="待订正错题"
              value={activeTotal}
              suffix="题"
              valueStyle={{ color: activeTotal ? '#e5484d' : undefined }}
              prefix={<WarningOutlined />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {activeTotal ? '答对一次就会自动移出，答错会重新进来' : '还没有错题，去练几道试试'}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic
              title="最需要补的分类"
              value={summary?.weakest?.categoryName ?? '暂无'}
              valueStyle={{ fontSize: 22 }}
              prefix={<BookOutlined />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {summary?.weakest ? `这个分类攒了 ${summary.weakest.count} 道错题` : '错题本还是空的'}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic
              title="错题分类分布"
              value={summary?.byCategory.length ?? 0}
              suffix="个分类"
              prefix={<ThunderboltOutlined />}
            />
            <Space size={4} wrap style={{ marginTop: 6 }}>
              {(summary?.byCategory ?? []).slice(0, 3).map((c) => (
                <Tag key={`${c.categoryId ?? 'none'}`} color="orange">
                  {c.categoryName} {c.count}
                </Tag>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ThunderboltOutlined />
                随机练习
              </Space>
            }
            extra={<Tag color="blue">不限次数</Tag>}
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 14 }}
              message="每次抽到的题都不一样，答完立刻看解析"
              description="分类留空就是从整个题库抽；选多个分类时按题量平均分配。"
            />
            <Form
              form={randomForm}
              layout="vertical"
              initialValues={{ categoryIds: [], count: 10, durationMin: 30 }}
              onValuesChange={(changed) => {
                if (changed.count !== undefined) setRandomCount(changed.count);
                if (changed.categoryIds !== undefined) setRandomCats(changed.categoryIds);
              }}
            >
              <Form.Item name="categoryIds" label="分类" tooltip="留空 = 整个题库；可以多选，题量会平均分到各分类">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="全部分类"
                  optionFilterProp="label"
                  maxTagCount="responsive"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Form.Item>
              <Space size={16} wrap>
                <Form.Item name="count" label="题目数量" rules={[{ required: true }]} tooltip="1–100 题">
                  <InputNumber min={1} max={100} style={{ width: 110 }} />
                </Form.Item>
                <Form.Item name="durationMin" label="时长（分钟）" rules={[{ required: true }]} tooltip="到点自动交卷">
                  <InputNumber min={1} max={1440} style={{ width: 120 }} />
                </Form.Item>
              </Space>
              {rulesPreview.length > 1 && (
                <div className="liti-practice-hint">
                  共 {randomCount} 题：
                  {rulesPreview
                    .map((r) => {
                      const name = categories.find((c) => c.id === r.categoryId)?.name ?? '题库';
                      return `${name} ${r.count} 题`;
                    })
                    .join('，')}
                </div>
              )}
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={starting === 'random'}
                disabled={!practiceEnabled}
                onClick={() => start('random')}
                block
              >
                生成随机练习卷
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <WarningOutlined />
                错题练习
              </Space>
            }
            extra={<Tag color={activeTotal ? 'red' : 'default'}>待订正 {activeTotal} 题</Tag>}
          >
            <Alert
              type={activeTotal ? 'warning' : 'success'}
              showIcon
              style={{ marginBottom: 14 }}
              message={activeTotal ? '只抽你还没订正的错题' : '错题本是空的'}
              description={
                activeTotal
                  ? '做对一次这道题就自动移出错题本；再错会重新回来，并累计错误次数。'
                  : '先做一份试卷或随机练习，答错的题会自动进错题本。'
              }
            />
            <Form form={wrongForm} layout="vertical" initialValues={{ count: 10, durationMin: 30, categoryId: null }}>
              <Space size={16} wrap>
                <Form.Item name="categoryId" label="只在某分类错题里抽" tooltip="留空 = 全部错题">
                  <Select
                    allowClear
                    style={{ width: 190 }}
                    placeholder="全部错题"
                    optionFilterProp="label"
                    options={(summary?.byCategory ?? []).map((c) => ({
                      value: c.categoryId as number,
                      label: `${c.categoryName}（${c.count}）`,
                    }))}
                  />
                </Form.Item>
                <Form.Item name="count" label="题目数量" rules={[{ required: true }]} tooltip="不能超过待订正题数">
                  <InputNumber min={1} max={Math.max(1, activeTotal)} style={{ width: 110 }} />
                </Form.Item>
                <Form.Item name="durationMin" label="时长（分钟）" rules={[{ required: true }]}>
                  <InputNumber min={1} max={1440} style={{ width: 120 }} />
                </Form.Item>
              </Space>
              <Space style={{ marginBottom: 12 }} wrap>
                <Button
                  size="small"
                  disabled={!activeTotal}
                  onClick={() => {
                    wrongForm.setFieldsValue({ count: activeTotal });
                  }}
                >
                  全选错题（{activeTotal} 题）
                </Button>
                <Button size="small" onClick={() => navigate('/wrong')}>
                  打开错题本
                </Button>
              </Space>
              <Button
                icon={<WarningOutlined />}
                loading={starting === 'wrong'}
                disabled={!practiceEnabled || !activeTotal}
                onClick={() => start('wrong')}
                block
              >
                生成错题练习卷
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card
        title="最近错题"
        style={{ marginTop: 16 }}
        extra={
          <Button type="link" onClick={() => navigate('/wrong')}>
            查看全部
          </Button>
        }
      >
        {recent.length ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {recent.map((w) => (
              <div key={w.id} className="liti-recent-wrong" onClick={() => navigate('/wrong')}>
                <Space size={8} wrap>
                  <Tag color="red">错 {w.wrongCount} 次</Tag>
                  <Tag>{w.type === 'multiple' ? '多选' : '单选'}</Tag>
                  {w.categoryName && <Tag color="blue">{w.categoryName}</Tag>}
                  <Text ellipsis style={{ maxWidth: 520 }}>
                    {w.stem || '（纯图片题）'}
                  </Text>
                </Space>
              </div>
            ))}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={user?.role === 'student' ? '还没有错题，先做几道题吧' : '当前账号没有错题记录'}
          />
        )}
      </Card>
    </div>
  );
}
