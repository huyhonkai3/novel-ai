-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'TRUNCATED', 'FAILED');

-- CreateTable
CREATE TABLE "Generation" (
    "id" UUID NOT NULL,
    "chapterId" UUID NOT NULL,
    "segmentId" UUID,
    "segmentKey" UUID NOT NULL,
    "chapterVersion" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "sourceText" TEXT NOT NULL,
    "originalChinese" TEXT,
    "promptVersion" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "actualModel" TEXT,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "output" TEXT NOT NULL DEFAULT '',
    "finishReason" TEXT,
    "usage" JSONB,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Generation_segmentId_idx" ON "Generation"("segmentId");

-- CreateIndex
CREATE INDEX "Generation_segmentKey_createdAt_idx" ON "Generation"("segmentKey", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_chapterId_createdAt_idx" ON "Generation"("chapterId", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_status_createdAt_idx" ON "Generation"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
