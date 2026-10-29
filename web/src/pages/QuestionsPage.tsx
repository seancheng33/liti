import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Radio, Select, Space, Table, Upload, message } from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { api, uploadXlsx } from '../api';
import { useAuth } from '../auth';
import type { Category, Question } from '../types';

const DIFFICULTY: Record<number, string> = { 1: '易', 2: '中', 3: '难' };

interface ImportSummary {
  success: number;
  failed: number;
  skippedDuplicates: number;
  rows: { row: number; ok: boolean; errors: string[] }[];
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
  const [form] = Form.useForm();
  const isManager = user?.role === 'admin' || user?.role === 'teacher';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: Question[]; total: number }>(`/api/questions?page=${page}&pageSize=20`);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await api.get<Category[]>('/api/categories'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    loadCategories();
  }, [load, loadCategories]);

  async function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'single', difficulty: 2, options: [{ content: '', isCorrect: false }, { content: '', isCorrect: false }] });
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

  async function onSave() {
    const values = await form.validateFields();
    const payload = {
      type: values.type,
      stem: values.stem,
      explanation: values.explanation ?? null,
      difficulty: values.difficulty,
      categoryId: values.categoryId ?? null,
      options: values.options,
    };
    try {
      if (editing) await api.put(`/api/questions/${editing.id}`, payload);
      else await api.post('/api/questions', payload);
      message.success('已保存');
      setModalOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onImport(file: File): Promise<false> {
    try {
      const buf = await file.arrayBuffer();
      const res = (await uploadXlsx('/api/questions/import', buf)) as ImportSummary;
      setImportResult(res);
      message.success(`导入完成：成功 ${res.success}，失败 ${res.failed}，重复 ${res.skippedDuplicates}`);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
    return false;
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '题干', dataIndex: 'stem', ellipsis: true },
    { title: '题型', dataIndex: 'type', width: 80, render: (t: string) => (t === 'single' ? '单选' : '多选') },
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
        <Space style={{ marginBottom: 16 }}>
          <Button icon={<PlusOutlined />} onClick={openCreate}>
            新建题目
          </Button>
          <Upload showUploadList={false} beforeUpload={onImport} accept=".xlsx">
            <Button icon={<UploadOutlined />}>Excel 导入</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} href="/api/questions/template">
            下载模板
          </Button>
        </Space>
      )}
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
              <Select allowClear style={{ width: 180 }} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title="导入结果" open={!!importResult} onCancel={() => setImportResult(null)} footer={null}>
        {importResult && (
          <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(importResult.rows, null, 2)}</pre>
        )}
      </Modal>
    </div>
  );
}
