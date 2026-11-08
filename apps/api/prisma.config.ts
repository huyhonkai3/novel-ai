import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // filepath trỏ tới file schema csdl
  schema: "prisma/schema.prisma",

  // Cấu hình thư mục lưu các bản ghi dữ liệu migration
  migrations: {
    path: "prisma/migrations",
  },

  // Cấu hình nguồn dữ liệu kết nối
  datasource: {
    url: env("DATABASE_URL"),
  },
});
