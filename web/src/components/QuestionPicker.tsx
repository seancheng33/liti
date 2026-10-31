import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { api } from '../api';
import type { Category, Question } from '../types';

interface Props {
  open: boolean;
  onCancel: () => void;
  onOk: (ids: number[], picked: Question[]) => void;
  initial?: Question[];
  categories: Category[];
}

const TYPE_LABEL: Record<string, string> = { single: '单选', multiple: '多选' };

/** 从题库中手动多选题目：支持分类/题型/关键词筛选，跨页保留选择 */
export default function QuestionPicker({ open, onCancel, onOk, initial, categories }: Props) {
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Map<number, Question>>(new Map());

  useEffect(() => {
    if (!open) return;
    const map = new Map<number, Question>();
    for (const q of initial ?? []) map.set(q.id, q);
    setPicked(map);
    setPage(1);
    setKeyword('');
    setCategoryId(undefined);
    setType(undefined);
    // 只在打开时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (keyword.trim()) qs.set('keyword', keyword.trim());
      if (categoryId != null) qs.set('categoryId', String(categoryId));
      if (type) qs.set('type', type);
      const res = await api.get<{ items: Question[]; total: number }>(`/api/questions?${qs.toString()}`);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, categoryId, type]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const selectedKeys = useMemo(() => [...picked.keys()], [picked]);

  function toggle(record: Question, selected: boolean) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (selected) next.set(record.id, record);
      else next.delete(record.id);
      return next;
    });
  }

  const categoryName = (id?: number | null) =>
    id == null ? '未分类' : categories.find((c) => c.id === id)?.name ?? `#${id}`;

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    {
      title: '题干',
      dataIndex: 'stem',
      ellipsis: true,
      render: (stem: string, r: Question) => (
        <Space size={6}>
          {r.images?.length ? <Tag color="purple">图</Tag> : null}
          <span>{stem || <span className="liti-muted">（纯图片题）</span>}</span>
        </Space>
      ),
    },
    { title: '题型', dataIndex: 'type', width: 76, render: (t: string) => TYPE_LABEL[t] ?? t },
    {
      title: '分类',
      dataIndex: 'category_id',
      width: 160,
      ellipsis: true,
      render: (id: number | null) => categoryName(id),
    },
  ];

  return (
    <Modal
      title="从题库选择题目"
      open={open}
      width={860}
      onCancel={onCancel}
      onOk={() => onOk([...picked.keys()], [...picked.values()])}
      okText={`确定（已选 ${picked.size} 题）`}
      cancelText="取消"
      destroyOnClose
    >
      <Space wrap style={{ marginBottom: 12 }}>
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
          style={{ width: 150 }}
          value={categoryId}
          onChange={(v) => {
            setPage(1);
            setCategoryId(v ?? undefined);
          }}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          allowClear
          placeholder="全部题型"
          style={{ width: 120 }}
          value={type}
          onChange={(v) => {
            setPage(1);
            setType(v ?? undefined);
          }}
          options={[
            { value: 'single', label: '单选' },
            { value: 'multiple', label: '多选' },
          ]}
        />
        <Typography.Text type="secondary">已选 {picked.size} 题</Typography.Text>
      </Space>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, size: 'small' }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          preserveSelectedRowKeys: true,
          onSelect: (record, selected) => toggle(record as Question, selected),
          onSelectAll: (selected, _rows, changeRows) => {
            setPicked((prev) => {
              const next = new Map(prev);
              for (const row of changeRows as Question[]) {
                if (selected) next.set(row.id, row);
                else next.delete(row.id);
              }
              return next;
            });
          },
        }}
      />

      {picked.size > 0 && (
        <div style={{ marginTop: 12, maxHeight: 110, overflow: 'auto' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已选题目（点 × 移除）
          </Typography.Text>
          <div style={{ marginTop: 6 }}>
            <Space size={[6, 6]} wrap>
              {[...picked.values()].map((q) => (
                <Tag
                  key={q.id}
                  closable
                  color="blue"
                  onClose={(e) => {
                    e.preventDefault();
                    toggle(q, false);
                  }}
                >
                  #{q.id} {(q.stem || '纯图片题').slice(0, 14)}
                </Tag>
              ))}
            </Space>
          </div>
        </div>
      )}
    </Modal>
  );
}
