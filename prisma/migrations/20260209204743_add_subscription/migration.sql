-- CreateTable
CREATE TABLE `subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `amount` DECIMAL(10, 2) NOT NULL,
    `credits` INTEGER NOT NULL,
    `paystack_authorization_code` VARCHAR(191) NULL,
    `paystack_customer_code` VARCHAR(191) NULL,
    `last_charged_at` DATETIME(3) NULL,
    `next_charge_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscriptions_user_id_idx`(`user_id`),
    INDEX `subscriptions_status_idx`(`status`),
    INDEX `subscriptions_next_charge_at_idx`(`next_charge_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
