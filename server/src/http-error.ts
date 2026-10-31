export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    /** 附加结构化信息（如查重命中的题目），会原样返回给前端 */
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
