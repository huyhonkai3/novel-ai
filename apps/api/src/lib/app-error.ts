// Mang lỗi có thể công khai qua các tầng mà không phụ thuộc Express.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name == "AppError";
  }
}
