import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Modal, Row, Space, Spin, Statistic, Tooltip, Typography, message } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  FlagOutlined,
  LoginOutlined,
  PlayCircleOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  ThunderboltOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import AppLayout from '../components/AppLayout';
import PublicShell from '../components/PublicShell';
import LoginForm from '../components/LoginForm';
import PaperPreviewModal from '../components/PaperPreviewModal';
import { type PaperPreview, type PublicOverview, type PublicPaper } from '../types';

/**
 * 首页：未登录也能看统计和已发布试卷，点「开始答题」才提示登录。
 * 登录后用 AppLayout 包起来，和站内其它页面保持同一套导航。
 */
export default function HomePage() {
  const { user, loading } = useAuth();
  const [overview, setOverview] = useState<PublicOverview | null>(null);
  const [papers, setPapers] = useState<PublicPaper[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PaperPreview | null>(null);
  const [previewPaperId, setPreviewPaperId] = useState<number | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setListLoading(true);
    try {
      const [ov, list] = await Promise.all([
        api.get<PublicOverview>('/api/public/overview'),
        api.get<{ items: PublicPaper[] }>('/api/public/papers'),
      ]);
      setOverview(ov);
      setPapers(list.items);
      document.title = ov.siteName || '砺题 Liti';
    } catch {
      // 首页拉不到数据不该白屏，静默降级成空列表
      setPapers([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openPreview(paperId: number) {
    setPreviewPaperId(paperId);
    setPreview(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const data = await api.get<PaperPreview>(`/api/public/papers/${paperId}`);
      setPreview(data);
    } catch (e) {
      message.error((e as Error).message);
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function startExam(paperId: number) {
    if (!user) {
      Modal.confirm({
        title: '需要先登录才能开始答题',
        content: '登录后答题记录会保存到你的账号里，交卷后还能回看解析。页面右侧就是登录入口。',
        okText: '去登录',
        cancelText: '我先看看题目',
        onOk: () => {
          document.getElementById('home-login')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          document.getElementById('login-username')?.focus();
        },
      });
      return;
    }
    try {
      const res = await api.post<{ id: number }>('/api/attempts', { paperId });
      navigate(`/exam/${res.id}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 120, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const content = (
    <HomeContent
      overview={overview}
      papers={papers}
      loading={listLoading}
      loggedIn={!!user}
      onPreview={openPreview}
      onStart={startExam}
      onGoPapers={() => navigate('/papers')}
    />
  );

  if (user) {
    return (
      <AppLayout>
        <div className="liti-page">
          {content}
          <PaperPreviewModal
            open={previewOpen}
            preview={preview}
            loading={previewLoading}
            onClose={() => setPreviewOpen(false)}
            extra={
              previewPaperId ? (
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => startExam(previewPaperId)}>
                  开始答题
                </Button>
              ) : null
            }
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <PublicShell siteName={overview?.siteName}>
      <div className="liti-hero">
        <Typography.Title level={1} className="liti-hero-title">
          千题磨一剑
          <br />
          把练习做成习惯
        </Typography.Title>
        <Typography.Paragraph className="liti-hero-desc">
          题库、组卷、答题、判分一条龙。看看下面的试卷，想练就直接进去；想自己出题，找老师要个账号。
        </Typography.Paragraph>
        <Space size={[8, 8]} wrap>
          <Button type="primary" size="large" icon={<LoginOutlined />} onClick={() => scrollToLogin()}>
            登录后开始答题
          </Button>
          <Button size="large" icon={<QuestionCircleOutlined />} onClick={() => navigate('/help')}>
            看看怎么用
          </Button>
        </Space>
      </div>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          {content}
        </Col>
        <Col xs={24} lg={8}>
          <div className="liti-home-side">
            <Card id="home-login" title="登录" size="small">
              <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
                账号由管理员或教师分配，登录后成绩会记录在你自己名下。
              </Typography.Paragraph>
              <LoginForm
                size="middle"
                autoFocus
                onSuccess={() => {
                  // 登录成功后 AuthProvider 会更新 user，这里只负责把页面滚回顶部
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </Card>

            <Card size="small" title="第一次来？" style={{ marginTop: 16 }}>
              <Space direction="vertical" size={8} style={{ fontSize: 13 }}>
                <span>
                  <ReadOutlined style={{ color: 'var(--liti-primary)', marginRight: 8 }} />
                  没账号请联系任课老师，管理员在「用户管理」里创建。
                </span>
                <span>
                  <PlayCircleOutlined style={{ color: 'var(--liti-primary)', marginRight: 8 }} />
                  登录后点试卷上的「开始答题」，倒计时会自动开始。
                </span>
                <span>
                  <ProfileOutlined style={{ color: 'var(--liti-primary)', marginRight: 8 }} />
                  交卷后在「我的答卷」里可以回看每题解析。
                </span>
                <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate('/help')}>
                  查看完整使用说明 →
                </Button>
              </Space>
            </Card>
          </div>
        </Col>
      </Row>

      <PaperPreviewModal
        open={previewOpen}
        preview={preview}
        loading={previewLoading}
        onClose={() => setPreviewOpen(false)}
        extra={
          previewPaperId ? (
            <Tooltip title="登录后即可作答">
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => startExam(previewPaperId)}>
                开始答题
              </Button>
            </Tooltip>
          ) : null
        }
      />
    </PublicShell>
  );
}

function scrollToLogin() {
  document.getElementById('home-login')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => document.getElementById('login-username')?.focus(), 300);
}

interface HomeContentProps {
  overview: PublicOverview | null;
  papers: PublicPaper[];
  loading: boolean;
  loggedIn: boolean;
  onPreview: (paperId: number) => void;
  onStart: (paperId: number) => void;
  onGoPapers: () => void;
}

/** 统计卡 + 已发布试卷网格：未登录/已登录共用 */
function HomeContent({ overview, papers, loading, loggedIn, onPreview, onStart, onGoPapers }: HomeContentProps) {
  const navigate = useNavigate();
  const s = overview?.stats;

  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card className="liti-stat-card" size="small">
            <Statistic
              title={
                <Space size={6}>
                  <BookOutlined />
                  题库题目
                </Space>
              }
              value={s?.questionCount ?? 0}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="liti-stat-card" size="small">
            <Statistic
              title={
                <Space size={6}>
                  <FileTextOutlined />
                  已发布试卷
                </Space>
              }
              value={s?.paperCount ?? 0}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="liti-stat-card" size="small">
            <Statistic
              title={
                <Space size={6}>
                  <ProfileOutlined />
                  累计答卷
                </Space>
              }
              value={s?.attemptCount ?? 0}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="liti-stat-card" size="small">
            <Statistic
              title={
                <Space size={6}>
                  <TeamOutlined />
                  参与人数
                </Space>
              }
              value={s?.userCount ?? 0}
            />
          </Card>
        </Col>
      </Row>

      {overview?.siteAnnouncement && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="站点公告"
          description={<span style={{ whiteSpace: 'pre-wrap' }}>{overview.siteAnnouncement}</span>}
        />
      )}

      <div className="liti-section-head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            已发布试卷
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            点开可以看卷面，确认合适再开始作答；不含答案。
          </Typography.Text>
        </div>
        {loggedIn && (
          <Button type="link" onClick={onGoPapers}>
            全部试卷 →
          </Button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : papers.length === 0 ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={2}>
                <span>还没有已发布的试卷</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  教师和管理员在「试卷」页建好卷子并点「发布」之后，就会出现在这里
                </Typography.Text>
              </Space>
            }
          />
        </Card>
      ) : (
        <Row gutter={[12, 12]}>
          {papers.map((p) => (
            <Col xs={24} sm={12} key={p.id}>
              <Card
                className="liti-paper-card"
                size="small"
                hoverable
                onClick={() => onPreview(p.id)}
                title={<span title={p.title}>{p.title}</span>}
              >
                <Space size={[10, 6]} wrap>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    <AppstoreOutlined /> {p.questionCount} 题
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    <ClockCircleOutlined /> {Math.round(p.durationSec / 60)} 分钟
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    <FlagOutlined /> 及格 {p.passScore} 分
                  </Typography.Text>
                </Space>
                <div className="liti-paper-actions" onClick={(e) => e.stopPropagation()}>
                  <Button size="small" type="text" onClick={() => onPreview(p.id)}>
                    预览卷面
                  </Button>
                  <Tooltip title={loggedIn ? '开始计时作答' : '需要先登录'}>
                    <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => onStart(p.id)}>
                      开始答题
                    </Button>
                  </Tooltip>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {loggedIn && (
        <Card size="small" style={{ marginTop: 20 }} title="快捷入口">
          <Space wrap>
            <Button icon={<ThunderboltOutlined />} onClick={onGoPapers}>
              随机练习
            </Button>
            <Button icon={<ProfileOutlined />} onClick={() => navigate('/attempts')}>
              我的答卷
            </Button>
            <Button icon={<QuestionCircleOutlined />} onClick={() => navigate('/help')}>
              使用帮助
            </Button>
          </Space>
        </Card>
      )}
    </>
  );
}
