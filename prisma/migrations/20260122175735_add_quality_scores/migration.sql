-- AlterTable
ALTER TABLE `resumes` ADD COLUMN `quality_score` JSON NULL,
    ADD COLUMN `similarity_metrics` JSON NULL;
