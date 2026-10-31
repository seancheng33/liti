import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Modal, Radio, Select, Space, Table, Tag, Upload, message } from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { api, uploadXlsx, ApiError } from '../api';
import { useAuth } from '../auth';
import type { Category, Question } from '../types';

const DIFFICULTY: Record<number, string> = { 1: '易', 2: '中', 3: '难' };

interface DuplicateHit {
  id: number;
  stem: string;
  type: string;
  match: 'exact' | 'similar';
}

interface ImportSummary {
  total: number;
  success: number;
  failed: number;
  skippedDuplicates: number;
  rows: { row: number; ok: boolean; errors: string[]; duplicateOf?: number }[];
}

export default function QuestionsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [importMode, setImportMode] = useState<'skip' | 'strict' | 'allow'>('skip');
  const [form] = Form.useForm();
  const isManager = user?.role === 'admin' || user?.role === 'teacher';

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [filterCategory, setFilterCategory] = useState<number | undefined>();
  const [filterDifficulty, setFilterDifficulty] = useState<number | undefined>();
  const [filterType, setFilterType] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (keyword.trim()) qs.set('keyword', keyword.trim());
      if (filterCategory != null) qs.set('categoryId', String(filterCategory));
      if (filterDifficulty != null) qs.set('difficulty', String(filterDifficulty));
      if (filterType) qs.set('type', filterType);
      const res = await api.get<{ items: Question[]; total: number }>(`/api/questions?${qs.toString()}`);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, filterCategory, filterDifficulty, filterType]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await api.get<Category[]>('/api/categories'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const categoryName = (id?: number | null) =>
    id == null ? '未分类' : categories.find((c) => c.id === id)?.name ?? `#${id}`;

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'single',
      difficulty: 2,
      options: [
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
      ],
    });
    setModalOpen(true);
  }

  async function openEdit(q: Question) {
    setEditing(q);
    try {
      const detail = await api.get<Question>(`/api/questions/${q.id}`);
      form.setFieldsValue({
        type: detail.type,
        stem: detail.stem,
        explanation: detail.explanation,
        difficulty: detail.difficulty,
        categoryId: detail.category_id,
        options: (detail.options ?? []).map((o) => ({ content: o.content, isCorrect: o.isCorrect })),
      });
      setModalOpen(true);
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  function buildPayload(values: Record<string, unknown>) {
    return {
      type: values.type,
      stem: values.stem,
      explanation: values.explanation ?? null,
      difficulty: values.difficulty,
      categoryId: values.categoryId ?? null,
      options: values.options,
    };
  }

  async function save(payload: Record<string, unknown>, allowDuplicate = false) {
    const body = { ...payload, ...(allowDuplicate ? { allowDuplicate: true } : {}) };
    if (editing) await api.put(`/api/questions/${editing.id}`, body);
    else await api.post('/api/questions', body);
  }

  async function onSave() {
    const values = await form.validateFields();
    const payload = buildPayload(values);
    try {
      await save(payload);
      message.success('已保存');
      setModalOpen(false);
      load();
    } catch (e) {
      // 409 = 命重重复题目，交给用户决定是否仍然保存
      if (e instanceof ApiError && e.status === 409) {
        const dup = (e.details as { duplicate?: DuplicateHit } | undefined)?.duplicate;
        Modal.confirm({
          title: '题库中已存在相同题目',
          content: dup ? (
            <div>
              <p style={{ marginBottom: 8 }}>
                命中的是{dup.match === 'exact' ? '完全相同的题干' : '忽略空格标点后相同的题干'}：
              </p>
              <Alert type="warning" showIcon message={`ID ${dup.id}：${dup.stem}`} />
              <p style={{ marginTop: 12, marginBottom: 0 }}>确实要再添加一条重复题目吗？</p>
            </div>
          ) : (
            e.message
          ),
          okText: '仍然保存',
          cancelText: '取消',
          onOk: async () => {
            try {
              await save(payload, true);
              message.success('已保存（重复题目）');
              setModalOpen(false);
              load();
            } catch (err) {
              message.error((err as Error).message);
            }
          },
        });
        return;
      }
      message.error((e as Error).message);
    }
  }

  async function onImport(file: File): Promise<false> {
    try {
      const buf = await file.arrayBuffer();
      const res = (await uploadXlsx(`/api/questions/import?mode=${importMode}&filename=${encodeURIComponent(file.name)}`, buf)) as ImportSummary;
      setImportResult(res);
      if (res.failed > 0) {
        message.warning(`导入完成：成功 ${res.success}，失败 ${res.failed}，其中重复 ${res.skippedDuplicates}`);
      } else {
        message.success(`导入完成：成功 ${res.success}`);
      }
      load();
      loadCategories();
    } catch (e) {
      message.error((e as Error).message);
    }
    return false;
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '题干', dataIndex: 'stem', ellipsis: true },
    { title: '题型', dataIndex: 'type', width: 80, render: (t: string) => (t === 'single' ? '单选' : '多选') },
    {
      title: '分类',
      dataIndex: 'category_id',
      width: 120,
      render: (id: number | null) =>
        id == null ? <Tag>未分类</Tag> : <Tag color="blue">{categoryName(id)}</Tag>,
    },
    { title: '难度', dataIndex: 'difficulty', width: 70, render: (d: number) => DIFFICULTY[d] ?? d },
    { title: '选项数', dataIndex: 'option_count', width: 80 },
    {
      title: '操作',
      key: 'op',
      width: 140,
      render: (_: unknown, r: Question) =>
        isManager ? (
          <Space>
            <a onClick={() => openEdit(r)}>编辑</a>
            <a
              onClick={async () => {
                await api.del(`/api/questions/${r.id}`);
                message.success('已删除');
                load();
              }}
            >
              删除
            </a>
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div>
      {isManager && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Button icon={<PlusOutlined />} type="primary" onClick={openCreate}>
            新建题目
          </Button>
          <Space.Compact>
            <Select
              value={importMode}
              onChange={(v) => setImportMode(v)}
              style={{ width: 150 }}
              options={[
                { value: 'skip', label: '重复则跳过' },
                { value: 'strict', label: '有重复则整批不导' },
                { value: 'allow', label: '重复也导入' },
              ]}
            />
            <Upload showUploadList={false} beforeUpload={onImport} accept=".xlsx">
              <Button icon={<UploadOutlined />}>Excel 导入</Button>
            </Upload>
          </Space.Compact>
          <Button icon={<DownloadOutlined />} href="/api/questions/template">
            下载模板
          </Button>
        </Space>
      )}

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          allowClear
          placeholder="按题干搜索"
          style={{ width: 220 }}
          onSearch={(v) => {
            setPage(1);
            setKeyword(v);
          }}
        />
        <Select
          allowClear
          placeholder="全部分类"
          style={{ width: 160 }}
          value={filterCategory}
          onChange={(v) => {
            setPage(1);
            setFilterCategory(v ?? undefined);
          }}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          allowClear
          placeholder="全部难度"
          style={{ width: 120 }}
          value={filterDifficulty}
          onChange={(v) => {
            setPage(1);
            setFilterDifficulty(v ?? undefined);
          }}
          options={[
            { value: 1, label: '易' },
            { value: 2, label: '中' },
            { value: 3, label: '难' },
          ]}
        />
        <Select
          allowClear
          placeholder="全部题型"
          style={{ width: 120 }}
          value={filterType}
          onChange={(v) => {
            setPage(1);
            setFilterType(v ?? undefined);
          }}
          options={[
            { value: 'single', label: '单选' },
            { value: 'multiple', label: '多选' },
          ]}
        />
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
      />

      <Modal title={editing ? '编辑题目' : '新建题目'} open={modalOpen} onOk={onSave} onCancel={() => setModalOpen(false)} width={760}>
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="题型" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="single">单选</Radio>
              <Radio value="multiple">多选</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="stem" label="题干" rules={[{ required: true, message: '请输入题干' }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.List name="options">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, index) => (
                  <Space key={field.key} align="start" style={{ display: 'flex' }}>
                    <span style={{ lineHeight: '32px', width: 20 }}>{String.fromCharCode(65 + index)}</span>
                    <Form.Item name={[field.name, 'content']} rules={[{ required: true, message: '选项内容' }]} style={{ marginBottom: 8 }}>
                      <Input style={{ width: 380 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'isCorrect']} valuePropName="checked" style={{ marginBottom: 8 }}>
                      <Checkbox>正确</Checkbox>
                    </Form.Item>
                    <Button size="small" onClick={() => remove(field.name)} disabled={fields.length <= 2}>
                      删除
                    </Button>
                  </Space>
                ))}
                <Button onClick={() => add({ content: '', isCorrect: false })} disabled={fields.length >= 6}>
                  添加选项（A–F）
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="explanation" label="解析">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space>
            <Form.Item name="difficulty" label="难度">
              <Select
                style={{ width: 120 }}
                options={[
                  { value: 1, label: '易' },
                  { value: 2, label: '中' },
                  { value: 3, label: '难' },
                ]}
              />
            </Form.Item>
            <Form.Item name="categoryId" label="分类">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 220 }}
                placeholder="选择分类（可搜索）"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                notFoundContent="还没有分类，可到「网站管理 → 分类管理」新建"
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title="导入结果"
        open={!!importResult}
        onCancel={() => setImportResult(null)}
        footer={null}
        width={680}
      >
        {importResult && (
          <div>
            <Space style={{ marginBottom: 12 }}>
              <Tag color="blue">共 {importResult.total} 行</Tag>
              <Tag color="green">成功 {importResult.success}</Tag>
              <Tag color="red">失败 {importResult.failed}</Tag>
              <Tag color="orange">其中重复 {importResult.skippedDuplicates}</Tag>
            </Space>
            <Table
              rowKey="row"
              size="small"
              pagination={{ pageSize: 10 }}
              dataSource={importResult.rows.filter((r) => !r.ok)}
              locale={{ emptyText: '没有失败或重复的行' }}
              columns={[
                { title: 'Excel 行号', dataIndex: 'row', width: 100 },
                {
                  title: '原因',
                  key: 'reason',
                  render: (_: unknown, r: ImportSummary['rows'][number]) => (
                    <Space direction="vertical" size={2}>
                      <span>{r.errors.join('；')}</span>
                      {r.duplicateOf != null && <Tag color="orange">与题库 ID {r.duplicateOf} 重复</Tag>}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
