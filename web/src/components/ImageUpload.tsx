import { useState } from 'react';
import { Image, Spin, Upload, message } from 'antd';
import { CloseOutlined, PictureOutlined, PlusOutlined } from '@ant-design/icons';
import { uploadImage } from '../api';

interface ImageUploadProps {
  value?: string[];
  onChange?: (value: string[]) => void;
  max?: number;
  /** sm 用于选项内的小缩略图 */
  size?: 'sm' | 'md';
}

/** 题目/选项配图上传：受控组件，value 是图片相对地址数组 */
export default function ImageUpload({ value = [], onChange, max = 6, size = 'md' }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const url = await uploadImage(file);
      onChange?.([...value, url].slice(0, max));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const thumbClass = `liti-image-thumb${size === 'sm' ? ' liti-image-thumb-sm' : ''}`;

  return (
    <div className="liti-image-grid">
      {value.map((url) => (
        <div className={thumbClass} key={url}>
          <Image src={url} alt="配图" />
          <button type="button" className="liti-image-remove" onClick={() => onChange?.(value.filter((v) => v !== url))}>
            <CloseOutlined />
          </button>
        </div>
      ))}

      {value.length < max && (
        <Upload
          accept="image/png,image/jpeg,image/webp,image/gif"
          showUploadList={false}
          multiple={false}
          beforeUpload={(file) => {
            handleFile(file as File);
            return false;
          }}
        >
          <div className="liti-upload-tile">
            {uploading ? <Spin size="small" /> : value.length ? <PlusOutlined /> : <PictureOutlined style={{ fontSize: 18 }} />}
            <span style={{ fontSize: 12, marginTop: 4 }}>{uploading ? '上传中' : '加图片'}</span>
          </div>
        </Upload>
      )}
    </div>
  );
}

/** 只读展示配图（答题页/解析页用） */
export function ImageGallery({ images, size = 'md' }: { images?: string[]; size?: 'sm' | 'md' }) {
  if (!images || !images.length) return null;
  const thumbClass = `liti-image-thumb${size === 'sm' ? ' liti-image-thumb-sm' : ''}`;
  return (
    <Image.PreviewGroup>
      <div className="liti-image-grid">
        {images.map((url) => (
          <div className={thumbClass} key={url}>
            <Image src={url} alt="题目配图" />
          </div>
        ))}
      </div>
    </Image.PreviewGroup>
  );
}
