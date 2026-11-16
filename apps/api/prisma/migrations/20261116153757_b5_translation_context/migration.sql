-- CreateTable
CREATE TABLE "GlossaryEntry" (
    "id" UUID NOT NULL,
    "novelId" UUID NOT NULL,
    "sourceTerm" VARCHAR(120) NOT NULL,
    "targetTerm" VARCHAR(120) NOT NULL,
    "notes" VARCHAR(400),
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlossaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryEntry_novelId_sourceKey_key" ON "GlossaryEntry"("novelId", "sourceKey");

-- AddForeignKey
ALTER TABLE "GlossaryEntry" ADD CONSTRAINT "GlossaryEntry_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Revision_approved_source_fts_idx"
ON "Revision" USING GIN (
    to_tsvector('simple'::regconfig, "sourceText")
)
WHERE "kind" = 'APPROVE' AND "text" IS NOT NULL;
