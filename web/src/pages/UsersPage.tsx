import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
  theme as antdTheme,
} from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { api, uploadXlsx } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';

const ROLE_LABEL: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };
const ROLE_COLOR: Record<string, string> = { admin: 'red', teacher: 'blue', student: 'green' };

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
  status: string;
  provider: string;
  created_at: number;
  /** 学号（学生才有，全校唯一） */
  studentNo?: string | null;
  /** 班级（学生才有） */
  className?: string | null;
  /** 所在分组（学生才有） */
  groups?: string[];
}

interface ImportSummary {
  dryRun: boolean;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  warnings: { row: number; message: string }[];
  errors: { row: number; message: string }[];
  defaultPassword: string;
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const { token } = antdTheme.useToken();
  const isAdmin = me?.role === 'admin';
  const [data, setData] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetForm] = Form.useForm();
  const [codeTarget, setCodeTarget] = useState<UserRow | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [classFilter, setClassFilter] = useState<string>('__all__');
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<UserRow[]>('/api/users'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate() {
    const values = await createForm.validateFields();
    try {
      // 教师视图里角色字段是隐藏的，这里显式补成 student（服务端也会拦非法角色）
      await api.post('/api/users', { ...values, role: isAdmin ? values.role : 'student' });
      message.success('已创建用户');
      setCreateOpen(false);
      createForm.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onEdit() {
    const values = await editForm.validateFields();
    try {
      // 教师不能改角色，只提交显示名与状态
      const body = isAdmin ? values : { displayName: values.displayName, status: values.status };
      await api.put(`/api/users/${editTarget!.id}`, body);
      message.success('已保存');
      setEditTarget(null);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onResetPassword() {
    const values = await resetForm.validateFields();
    try {
      await api.post(`/api/users/${resetTarget!.id}/reset-password`, { password: values.password });
      message.success('密码已重置');
      setResetTarget(null);
      resetForm.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 签发一次性重置码：教师/管理员生成，学生登录取码自助改密码 */
  async function onIssueCode(r: UserRow) {
    setCodeTarget(r);
    setIssuedCode(null);
    setCodeCopied(false);
    setCodeLoading(true);
    try {
      const res = await api.post<{ code: string; expiresAt: number }>(`/api/users/${r.id}/reset-code`);
      setIssuedCode(res.code);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setCodeLoading(false);
    }
  }

  async function runImport(file: File, dryRun: boolean) {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const res = (await uploadXlsx(`/api/users/import?dryRun=${dryRun ? '1' : '0'}`, buf)) as ImportSummary;
      setImportResult(res);
      if (!dryRun) {
        message.success(`已导入 ${res.created} 个学生${res.skipped ? `，跳过 ${res.skipped} 行` : ''}`);
        load();
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await api.del(`/api/users/${id}`);
      message.success('已删除');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  // 班级下拉：只列真实存在的班级，避免下拉里一堆空选项
  const classOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of data) if (u.className) set.add(u.className);
    return [...set].sort();
  }, [data]);

  // 名单一长就必须能查。只在前端过滤：一个部署的学生数最多几千，够了
  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return data.filter((u) => {
      if (classFilter !== '__all__' && (u.className ?? '') !== classFilter) return false;
      if (!kw) return true;
      return (
        u.username.toLowerCase().includes(kw) ||
        u.display_name.toLowerCase().includes(kw) ||
        (u.studentNo ?? '').toLowerCase().includes(kw) ||
        (u.className ?? '').toLowerCase().includes(kw)
      );
    });
  }, [data, keyword, classFilter]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '用户名',
      dataIndex: 'username',
      width: 150,
      render: (v: string, r: UserRow) => (
        <Space size={4}>
          <span>{v}</span>
          {r.provider !== 'local' && <Tag color="purple">SSO</Tag>}
        </Space>
      ),
    },
    {
      title: '姓名',
      dataIndex: 'display_name',
      width: 110,
    },
    {
      title: '学号',
      dataIndex: 'studentNo',
      width: 120,
      render: (v: string | null | undefined) => v || <span className="liti-muted">-</span>,
    },
    {
      title: '班级',
      dataIndex: 'className',
      width: 130,
      render: (v: string | null | undefined) => (v ? <Tag color="cyan">{v}</Tag> : <span className="liti-muted">-</span>),
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (r: string) => <Tag color={ROLE_COLOR[r]}>{ROLE_LABEL[r] ?? r}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 84,
      render: (s: string) => (s === 'active' ? <Tag color="green">正常</Tag> : <Tag color="default">停用</Tag>),
    },
    {
      title: '分组',
      dataIndex: 'groups',
      width: 170,
      render: (groups: string[] | undefined) =>
        groups?.length ? (
          <Space size={4} wrap>
            {groups.map((g) => (
              <Tag key={g} color="blue" style={{ marginInlineEnd: 0 }}>
                {g}
              </Tag>
            ))}
          </Space>
        ) : (
          <span className="liti-muted">{me?.role === 'teacher' ? '未分组' : '-'}</span>
        ),
    },
    {
      title: '操作',
      key: 'op',
      width: 176,
      fixed: 'right' as const,
      render: (_: unknown, r: UserRow) => (
        <Space>
          <a
            onClick={() => {
              setEditTarget(r);
              editForm.setFieldsValue({
                displayName: r.display_name,
                role: r.role,
                status: r.status,
                studentNo: r.studentNo ?? '',
                className: r.className ?? '',
              });
            }}
          >
            编辑
          </a>
          <a
            onClick={() => {
              setResetTarget(r);
              resetForm.resetFields();
            }}
          >
            重置密码
          </a>
          <a onClick={() => onIssueCode(r)}>生成重置码</a>
          <Popconfirm title="确认删除该用户？" onConfirm={() => onDelete(r.id)} disabled={r.id === me?.userId}>
            <a style={{ color: r.id === me?.userId ? '#ccc' : undefined }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="liti-page">
      <PageHeader
        title={isAdmin ? '用户管理' : '学生管理'}
        description={
          isAdmin
            ? '创建账号、调整角色、重置密码。删除用户会一并清理其答卷、错题库与分组归属。'
            : '你在这里可以创建学生账号、改显示名、重置密码、停用或删除学生。教师与管理员的账号只有管理员能改。'
        }
        extra={
          <Space>
            <Button
              icon={<UploadOutlined />}
              onClick={() => {
                setImportResult(null);
                setImportOpen(true);
              }}
            >
              导入学生名单
            </Button>
            <Button
              icon={<PlusOutlined />}
              type="primary"
              onClick={() => {
                setCreateOpen(true);
                createForm.resetFields();
                createForm.setFieldsValue({ role: 'student' });
              }}
            >
              {isAdmin ? '新建用户' : '新建学生'}
            </Button>
          </Space>
        }
      />

      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="教师账号只能管理学生"
          description="要按班发卷，可以到「学生分组」把人分好；这里建完学生后直接去分组里勾选即可。"
        />
      )}

      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input.Search
            allowClear
            placeholder="搜用户名 / 姓名 / 学号 / 班级"
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            style={{ width: 180 }}
            value={classFilter}
            onChange={setClassFilter}
            options={[{ value: '__all__', label: '全部班级' }, ...classOptions.map((c) => ({ value: c, label: c }))]}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            共 {shown.length} 人{classFilter !== '__all__' ? `（${classFilter}）` : ''}
          </Typography.Text>
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={shown}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 1090 }}
          locale={{ emptyText: keyword || classFilter !== '__all__' ? '没有匹配的账号' : '还没有账号，点右上角「新建用户」创建第一个' }}
        />
      </Card>

      {/* 新建用户 */}
      <Modal title="新建用户" open={createOpen} onOk={onCreate} onCancel={() => setCreateOpen(false)}>
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
            tooltip="登录用，创建后不能修改"
          >
            <Input placeholder="字母、数字、下划线" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]} tooltip="成绩单和答卷列表里显示的名字">
            <Input />
          </Form.Item>
          <Form.Item
            name="studentNo"
            label="学号"
            tooltip="选填，全校唯一；成绩册按学号排序才对得上教务的名单"
            rules={[{ pattern: /^[a-zA-Z0-9_-]*$/, message: '只能包含字母、数字、下划线和连字符' }]}
          >
            <Input placeholder="选填，如 20260101" />
          </Form.Item>
          <Form.Item name="className" label="班级" tooltip="选填，如「高一(3)班」；按班导出成绩需要它">
            <Input placeholder="选填，如 高一(3)班" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}
            tooltip="至少 6 位；创建后可以随时在列表里重置"
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true }]}
            tooltip={
              isAdmin
                ? '学生只能答题；教师可管题库、试卷、分组和学生；管理员还能管账号与站点配置'
                : '教师只能创建学生账号'
            }
            hidden={!isAdmin}
          >
            <Radio.Group>
              <Radio value="student">学生</Radio>
              <Radio value="teacher">教师</Radio>
              <Radio value="admin">管理员</Radio>
            </Radio.Group>
          </Form.Item>
          {!isAdmin && (
            <Form.Item label="角色" tooltip="教师只能创建学生账号">
              <Input value="学生" disabled />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 编辑用户 */}
      <Modal title={`编辑用户：${editTarget?.username ?? ''}`} open={!!editTarget} onOk={onEdit} onCancel={() => setEditTarget(null)}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="displayName" label="显示名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="studentNo"
            label="学号"
            tooltip="全校唯一；清空即取消学号"
            rules={[{ pattern: /^[a-zA-Z0-9_-]*$/, message: '只能包含字母、数字、下划线和连字符' }]}
          >
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="className" label="班级" tooltip="清空即取消班级">
            <Input placeholder="选填，如 高一(3)班" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]} hidden={!isAdmin}>
            <Select
              options={[
                { value: 'student', label: '学生' },
                { value: 'teacher', label: '教师' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Form.Item>
          {!isAdmin && (
            <Form.Item label="角色" tooltip="教师不能修改账号角色">
              <Input value="学生" disabled />
            </Form.Item>
          )}
          <Form.Item name="status" label="状态">
            <Radio.Group>
              <Radio value="active">正常</Radio>
              <Radio value="disabled">停用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal title={`重置密码：${resetTarget?.username ?? ''}`} open={!!resetTarget} onOk={onResetPassword} onCancel={() => setResetTarget(null)}>
        <Form form={resetForm} layout="vertical">
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      {/* 生成重置码 */}
      <Modal
        title={`重置码：${codeTarget?.username ?? ''}`}
        open={!!codeTarget}
        onCancel={() => setCodeTarget(null)}
        footer={[
          <Button key="close" onClick={() => setCodeTarget(null)}>
            关闭
          </Button>,
        ]}
      >
        {codeLoading ? (
          <Typography.Text type="secondary">生成中…</Typography.Text>
        ) : issuedCode ? (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14 }}
              message="请把这串码当面或私发给本人"
              description="重置码是一次性的、30 分钟内有效，用完后即作废。不要截图发到群里，也不要发给无关的人。"
            />
            <Typography.Paragraph type="secondary" style={{ marginBottom: 6 }}>
              重置码（点一下全选复制）：
            </Typography.Paragraph>
            <div
              onClick={(e) => {
                const t = e.currentTarget;
                const range = document.createRange();
                range.selectNodeContents(t);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
                navigator.clipboard?.writeText(issuedCode).then(
                  () => {
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  },
                  () => {},
                );
              }}
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 26,
                letterSpacing: 6,
                fontWeight: 700,
                textAlign: 'center',
                padding: '14px 8px',
                background: token.colorFillSecondary,
                borderRadius: 8,
                cursor: 'pointer',
                userSelect: 'all',
              }}
            >
              {issuedCode}
            </div>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 13 }}>
              {codeCopied
                ? '已复制到剪贴板'
                : '提示：学生登录页点「忘记密码」，输入用户名、这串码和新密码即可自行重置，无需后台代劳。'}
            </Typography.Paragraph>
          </>
        ) : (
          <Typography.Text type="secondary">生成失败，请重试或刷新页面。</Typography.Text>
        )}
      </Modal>

      {/* 导入学生名单 */}
      <Modal
        title="导入学生名单"
        open={importOpen}
        width={720}
        onCancel={() => setImportOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setImportOpen(false)}>关闭</Button>
            {importResult?.dryRun && importResult.created > 0 && (
              <Button type="primary" loading={importing} onClick={() => pendingFile && runImport(pendingFile, false)}>
                确认导入 {importResult.created} 人
              </Button>
            )}
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="先下载模板填好再上传"
          description={
            <span>
              列顺序：用户名 / 姓名 / 学号 / 班级 / 初始密码 / 分组。学号选填但全校唯一；
              初始密码留空的学生统一用默认密码。{' '}
              <a href="/api/users/template">下载模板</a>
            </span>
          }
        />
        <Upload
          showUploadList={false}
          accept=".xlsx"
          beforeUpload={(file) => {
            setPendingFile(file);
            runImport(file, true);
            return false;
          }}
        >
          <Button icon={<DownloadOutlined />} loading={importing}>
            选择 xlsx 文件（只预检，不写入）
          </Button>
        </Upload>

        {importResult && (
          <div style={{ marginTop: 16 }}>
            <Space size={6} wrap style={{ marginBottom: 10 }}>
              <Tag color="blue">共 {importResult.total} 行</Tag>
              <Tag color="green">{importResult.dryRun ? '可导入' : '已导入'} {importResult.created}</Tag>
              <Tag color="orange">跳过 {importResult.skipped}</Tag>
              <Tag color="red">有问题 {importResult.failed}</Tag>
            </Space>
            {!importResult.dryRun && importResult.created > 0 && (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 10 }}
                message={`初始密码（未填密码的学生都用它）：${importResult.defaultPassword}`}
                description="请把这份名单发下去，并提醒学生首次登录后到「个人设置」改密码。"
              />
            )}
            {importResult.errors.length > 0 && (
              <Table
                size="small"
                rowKey={(r) => `e${r.row}`}
                pagination={false}
                style={{ marginBottom: 10 }}
                dataSource={importResult.errors.slice(0, 20)}
                columns={[
                  { title: '行号', dataIndex: 'row', width: 70 },
                  { title: '问题（这行不会导入）', dataIndex: 'message' },
                ]}
              />
            )}
            {importResult.warnings.length > 0 && (
              <Table
                size="small"
                rowKey={(r) => `w${r.row}${r.message}`}
                pagination={false}
                dataSource={importResult.warnings.slice(0, 20)}
                columns={[
                  { title: '行号', dataIndex: 'row', width: 70 },
                  { title: '提示（这行被跳过）', dataIndex: 'message' },
                ]}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
