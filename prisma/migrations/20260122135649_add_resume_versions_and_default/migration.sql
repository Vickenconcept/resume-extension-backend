-- AlterTable
ALTER TABLE `resumes` ADD COLUMN `display_name` VARCHAR(191) NULL,
    ADD COLUMN `folder` VARCHAR(191) NULL,
    ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `resume_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resume_id` INTEGER NOT NULL,
    `version_name` VARCHAR(191) NULL,
    `tailored_resume_text` TEXT NOT NULL,
    `cover_letter` TEXT NULL,
    `tailored_docx_url` VARCHAR(191) NULL,
    `tailored_pdf_url` VARCHAR(191) NULL,
    `download_urls` JSON NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `resume_versions_resume_id_idx`(`resume_id`),
    INDEX `resume_versions_resume_id_is_current_idx`(`resume_id`, `is_current`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `resumes_user_id_is_default_idx` ON `resumes`(`user_id`, `is_default`);

-- AddForeignKey
ALTER TABLE `resume_versions` ADD CONSTRAINT `resume_versions_resume_id_fkey` FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
