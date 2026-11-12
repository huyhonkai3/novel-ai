-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('MANUAL', 'AI_ACCEPT', 'AI_REJECT', 'RESTORE', 'APPROVE');

-- AlterTable
ALTER TABLE "Segment" ADD COLUMN     "approvedRevisionId" UUID,
ADD COLUMN     "draftRevisionId" UUID,
ADD COLUMN     "editVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Revision" (
    "id" UUID NOT NULL,
    "chapterId" UUID NOT NULL,
    "segmentId" UUID,
    "segmentKey" UUID NOT NULL,
    "chapterVersion" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "RevisionKind" NOT NULL,
    "text" TEXT,
    "sourceText" TEXT NOT NULL,
    "originalChinese" TEXT,
    "generationId" UUID,
    "parentRevisionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Revision_segmentId_idx" ON "Revision"("segmentId");

-- CreateIndex
CREATE INDEX "Revision_chapterId_createdAt_idx" ON "Revision"("chapterId", "createdAt");

-- CreateIndex
CREATE INDEX "Revision_generationId_idx" ON "Revision"("generationId");

-- CreateIndex
CREATE INDEX "Revision_parentRevisionId_idx" ON "Revision"("parentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_segmentKey_sequence_key" ON "Revision"("segmentKey", "sequence");

-- CreateIndex
CREATE INDEX "Segment_draftRevisionId_idx" ON "Segment"("draftRevisionId");

-- CreateIndex
CREATE INDEX "Segment_approvedRevisionId_idx" ON "Segment"("approvedRevisionId");

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_draftRevisionId_fkey" FOREIGN KEY ("draftRevisionId") REFERENCES "Revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "Revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "Revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
