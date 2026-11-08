import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Giới hạn pool và thời gian chờ để health check không tro khi DB mất kết nối.
export function createPrisma(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
  });

  return new PrismaClient({ adapter });
}
