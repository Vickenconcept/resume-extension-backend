-- AlterTable
-- Extend token column to store JWT (was VARCHAR(191), now VARCHAR(768) for MySQL unique index limit with utf8mb4)
ALTER TABLE `tokens` MODIFY COLUMN `token` VARCHAR(768) NOT NULL;
