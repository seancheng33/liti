import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import { DownloadOutlined, ExportOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { api, uploadXlsx, ApiError } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';
import ImageUpload from '../components/ImageUpload';
import type { Category, Question } from '../types';

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

/** 新建/编辑题目时提交给后端的结构 */
interface QuestionPayload {
  type: string;
  stem: string;
  images: string[];
  explanation: string | null;
  categoryId: number | null;
  options: { content: string; isCorrect: boolean; images: string[] }[];
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
  const [filterType, setFilterType] = useState<string | undefined>();

  // 批量操作（batchCategory 用 0 代表「未分类」，undefined 代表还没选）
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchCategory, setBatchCategory] = useState<number | undefined>(undefined);
  const [batchLoading, setBatchLoading] = useState(false);

  /** 导出带上当前筛选条件，所见即所得 */
  const exportUrl = (() => {
    const qs = new URLSearchParams();
    if (keyword.trim()) qs.set('keyword', keyword.trim());
    if (filterCategory != null) qs.set('categoryId', String(filterCategory));
    if (filterType) qs.set('type', filterType);
    const s = qs.toString();
    return `/api/questions/export${s ? `?${s}` : ''}`;
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (keyword.trim()) qs.set('keyword', keyword.trim());
      if (filterCategory != null) qs.set('categoryId', String(filterCategory));
      if (filterType) qs.set('type', filterType);
      const res = await api.get<{ items: Question[]; total: number }>(`/api/questions?${qs.toString()}`);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, filterCategory, filterType]);

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
      images: [],
      options: [
        { content: '', isCorrect: false, images: [] },
        { content: '', isCorrect: false, images: [] },
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
        images: detail.images ?? [],
        explanation: detail.explanation,
        categoryId: detail.category_id,
        options: (detail.options ?? []).map((o) => ({
          content: o.content,
          isCorrect: o.isCorrect,
          images: o.images ?? [],
        })),
      });
      setModalOpen(true);
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function save(payload: QuestionPayload, allowDuplicate = false) {
    const body = allowDuplicate ? { ...payload, allowDuplicate: true } : payload;
    if (editing) await api.put(`/api/questions/${editing.id}`, body);
    else await api.post('/api/questions', body);
  }

  async function onSave() {
    const values = await form.validateFields();
    const payload: QuestionPayload = {
      type: values.type,
      stem: values.stem ?? '',
      images: values.images ?? [],
      explanation: values.explanation ?? null,
      categoryId: values.categoryId ?? null,
      options: (values.options ?? []).map((o: { content?: string; isCorrect?: boolean; images?: string[] }) => ({
        content: o.content ?? '',
        isCorrect: !!o.isCorrect,
        images: o.images ?? [],
      })),
    };

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
              <Alert type="warning" showIcon message={`ID ${dup.id}：${dup.stem || '（纯图片题）'}`} />
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
      const res = (await uploadXlsx(
        `/api/questions/import?mode=${importMode}&filename=${encodeURIComponent(file.name)}`,
        buf,
      )) as ImportSummary;
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

  async function onDelete(id: number) {
    try {
      const r = await api.del<{ archived: number; usedInPapers: number }>(`/api/questions/${id}`);
      message.success(
        r.usedInPapers > 0
          ? `已从题库删除；这题还在 ${r.usedInPapers} 份试卷里，那些试卷照常能看能考`
          : '已从题库删除',
      );
      setSelectedIds((ids) => ids.filter((x) => x !== id));
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 批量改分类 / 批量删除 */
  async function runBatch(action: 'delete' | 'category', categoryId?: number | null) {
    if (!selectedIds.length) return;
    setBatchLoading(true);
    try {
      const res = await api.post<{ archived?: number; updated?: number; usedInPapers?: number }>('/api/questions/batch', {
        ids: selectedIds,
        action,
        ...(action === 'category' ? { categoryId: categoryId ?? null } : {}),
      });
      if (action === 'delete') {
        message.success(
          res.usedInPapers
            ? `已删除 ${res.archived} 题；其中被 ${res.usedInPapers} 份试卷引用的题目仍会正常显示在那些试卷里`
            : `已删除 ${res.archived} 题`,
        );
        setSelectedIds([]);
      } else {
        message.success(`已把 ${res.updated} 题改为「${categoryId == null ? '未分类' : categoryName(categoryId)}」`);
        setBatchCategory(undefined);
        setSelectedIds([]);
      }
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBatchLoading(false);
    }
  }

  function confirmBatchDelete() {
    Modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 道题？`,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>题目会从题库列表里消失。</p>
          <Alert
            type="info"
            showIcon
            message="已经组进试卷的题目，在那些试卷里照常显示"
            description="删除只是把题目从题库隐藏，历史试卷、已发布试卷和已经交过的答卷都还能正常看到题面和解析。"
          />
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => runBatch('delete'),
    });
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    {
      title: '题干',
      dataIndex: 'stem',
      ellipsis: true,
      render: (stem: string, r: Question) => (
        <Space size={6}>
          {r.images?.length ? (
            <Tooltip title={`${r.images.length} 张配图`}>
              <Tag color="purple">图</Tag>
            </Tooltip>
          ) : null}
          <span>{stem || <span className="liti-muted">（纯图片题）</span>}</span>
        </Space>
      ),
    },
    { title: '题型', dataIndex: 'type', width: 80, render: (t: string) => (t === 'single' ? '单选' : '多选') },
    {
      title: '分类',
      dataIndex: 'category_id',
      width: 130,
      render: (id: number | null) => (id == null ? <Tag>未分类</Tag> : <Tag color="blue">{categoryName(id)}</Tag>),
    },
    { title: '选项数', dataIndex: 'option_count', width: 80 },
    {
      title: '操作',
      key: 'op',
      width: 130,
      render: (_: unknown, r: Question) =>
        isManager ? (
          <Space size={12}>
            <a onClick={() => openEdit(r)}>编辑</a>
            <Tooltip title="从题库删除；已组进试卷的仍会在那些试卷里正常显示">
              <a style={{ color: '#e5484d' }} onClick={() => onDelete(r.id)}>
                删除
              </a>
            </Tooltip>
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div className="liti-page">
      <PageHeader
        title="题库"
        description="支持单选题与多选题，题干和选项都可以配图。勾选左侧方框可以批量改分类或批量删除；删除的题目只是离开题库，已组进试卷的仍会正常显示。"
        extra={
          isManager ? (
            <>
              <Space.Compact>
                <Tooltip title="导入时遇到与已有题目重复的行怎么办">
                  <Select
                    value={importMode}
                    onChange={(v) => setImportMode(v)}
                    style={{ width: 160 }}
                    options={[
                      { value: 'skip', label: '重复则跳过' },
                      { value: 'strict', label: '有重复则整批不导' },
                      { value: 'allow', label: '重复也导入' },
                    ]}
                  />
                </Tooltip>
                <Upload showUploadList={false} beforeUpload={onImport} accept=".xlsx">
                  <Button icon={<UploadOutlined />}>Excel 导入</Button>
                </Upload>
              </Space.Compact>
              <Tooltip title="下载模板：题型列是下拉菜单，表头有填写说明">
                <Button icon={<DownloadOutlined />} href="/api/questions/template">
                  模板
                </Button>
              </Tooltip>
              <Tooltip title="按当前筛选条件导出为 Excel，列结构和导入模板一致，改完可以直接导回来">
                <Button icon={<ExportOutlined />} href={exportUrl}>
                  导出
                </Button>
              </Tooltip>
              <Tooltip title="题干和选项都可以配图；只放图片的题目可以不写题干">
                <Button icon={<PlusOutlined />} type="primary" onClick={openCreate}>
                  新建题目
                </Button>
              </Tooltip>
            </>
          ) : null
        }
      />

      <Card styles={{ body: { padding: 0 } }}>
        <div className="liti-filter-bar">
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="按题干搜索"
              style={{ width: 240 }}
              onSearch={(v) => {
                setPage(1);
                setKeyword(v);
              }}
            />
            <Select
              allowClear
              placeholder="全部分类"
              style={{ width: 170 }}
              value={filterCategory}
              onChange={(v) => {
                setPage(1);
                setFilterCategory(v ?? undefined);
              }}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Select
              allowClear
              placeholder="全部题型"
              style={{ width: 130 }}
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
        </div>

        {/* 勾选后浮出的批量工具条 */}
        {isManager && selectedIds.length > 0 && (
          <div className="liti-batch-bar">
            <Space wrap size={12}>
              <span>
                已选 <strong>{selectedIds.length}</strong> 题
              </span>
              <Space.Compact>
                <Select
                  placeholder="改到哪个分类"
                  style={{ width: 190 }}
                  value={batchCategory}
                  onChange={(v) => setBatchCategory(v)}
                  options={[{ value: 0, label: '未分类（清空分类）' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                />
                <Button
                  loading={batchLoading}
                  disabled={batchCategory === undefined}
                  onClick={() => runBatch('category', batchCategory === 0 ? null : batchCategory)}
                >
                  批量改分类
                </Button>
              </Space.Compact>
              <Button danger loading={batchLoading} onClick={confirmBatchDelete}>
                批量删除
              </Button>
              <Button type="link" size="small" onClick={() => setSelectedIds([])}>
                取消选择
              </Button>
            </Space>
          </div>
        )}

        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          rowSelection={
            isManager
              ? {
                  selectedRowKeys: selectedIds,
                  onChange: (keys) => setSelectedIds(keys as number[]),
                  preserveSelectedRowKeys: false,
                }
              : undefined
          }
          locale={{
            emptyText: keyword || filterCategory || filterType ? '没有符合条件的题目，换个筛选条件试试' : '题库还是空的，点右上角「新建题目」或「Excel 导入」开始建题',
          }}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        />
      </Card>

      {/* ---------- 新建 / 编辑题目 ---------- */}
      <Modal
        title={editing ? `编辑题目 #${editing.id}` : '新建题目'}
        open={modalOpen}
        onOk={onSave}
        onCancel={() => setModalOpen(false)}
        width={820}
        okText="保存"
        cancelText="取消"
        styles={{ body: { maxHeight: '64vh', overflowY: 'auto', paddingRight: 8 } }}
      >
        <Form form={form} layout="vertical">
          <Space size={16} wrap>
            <Form.Item name="type" label="题型" rules={[{ required: true }]}>
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value="single">单选</Radio.Button>
                <Radio.Button value="multiple">多选</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item name="categoryId" label="分类">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 240 }}
                placeholder="选择分类（可搜索）"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                notFoundContent="还没有分类，去「分类管理」新建"
              />
            </Form.Item>
          </Space>

          <Form.Item name="stem" label="题干" tooltip="题干留空、只放配图也能保存，会显示为「纯图片题」">
            <Input.TextArea rows={3} placeholder="题干文字；如果只有图片，可以留空" />
          </Form.Item>

          <Form.Item name="images" label="题干配图（最多 6 张）" tooltip="支持 png / jpg / webp / gif，单张不超过 4MB">
            <ImageUpload max={6} />
          </Form.Item>

          <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>
            选项（至少 2 个，单选只能勾 1 个正确答案，多选至少勾 2 个）
          </Divider>

          <Form.List name="options">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, index) => (
                  <Card key={field.key} size="small" style={{ marginBottom: 10, background: 'transparent' }}>
                    <Space align="start" style={{ display: 'flex' }}>
                      <span style={{ lineHeight: '34px', width: 20, fontWeight: 700 }}>{String.fromCharCode(65 + index)}</span>
                      <Form.Item name={[field.name, 'content']} style={{ marginBottom: 0, flex: 1 }}>
                        <Input placeholder={`选项 ${String.fromCharCode(65 + index)} 文字`} style={{ width: 470 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'isCorrect']} valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Checkbox>正确答案</Checkbox>
                      </Form.Item>
                      <Button size="small" danger type="text" disabled={fields.length <= 2} onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Space>
                    <Form.Item name={[field.name, 'images']} style={{ marginBottom: 0, marginTop: 8 }}>
                      <ImageUpload size="sm" max={3} />
                    </Form.Item>
                  </Card>
                ))}
                <Button type="dashed" block onClick={() => add({ content: '', isCorrect: false, images: [] })} disabled={fields.length >= 6}>
                  添加选项（A–F）
                </Button>
              </>
            )}
          </Form.List>

          <Form.Item name="explanation" label="解析" style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} placeholder="可选，交卷后展示给答题人" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---------- 导入结果 ---------- */}
      <Modal title="导入结果" open={!!importResult} onCancel={() => setImportResult(null)} footer={null} width={680}>
        {importResult && (
          <div>
            <Space style={{ marginBottom: 12 }} wrap>
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
